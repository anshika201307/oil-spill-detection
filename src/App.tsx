import React, { useEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import { Navbar, NavTabType } from './components/Navbar';
import { HeroSection } from './components/HeroSection';
import { IntelligenceBentoGrid } from './components/IntelligenceBentoGrid';
import { InvestigationTheater } from './components/InvestigationTheater';
import { SatelliteAnalysisView } from './components/SatelliteAnalysisView';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { SystemStatus } from './components/SystemStatus';
import { SimulationStudio } from './components/SimulationStudio';
import { CourtDossierModal } from './components/CourtDossierModal';
import { AiAnalystDrawer } from './components/AiAnalystDrawer';
import { HowItWorksModal } from './components/HowItWorksModal';
import { ThemeSettingsModal, ThemeMode } from './components/ThemeSettingsModal';
import { IntroLoadingAnimation } from './components/IntroLoadingAnimation';
import { Footer } from './components/Footer';
import { MOCK_INCIDENTS } from './data/mockIncidents';
import { SpillIncident, CorrelatedVessel } from './types';
import { rankVesselsByAttribution } from './services/aisCorrelationEngine';
import { runDeterministicDriftModel } from './services/driftModel';
import {
  ATTRIBUTION_DISCLAIMER,
  AisTrackRecord,
  candidatesFromAisRecords,
  metoceanFromVectors,
} from './services/sampleAnalysisProviders';

const INCIDENTS_STORAGE_KEY = 'oiltrace.incidents.v1';
const SELECTED_INCIDENT_STORAGE_KEY = 'oiltrace.selectedIncident.v1';

function loadInitialAppState() {
  try {
    const serializedIncidents = window.localStorage.getItem(INCIDENTS_STORAGE_KEY);
    const savedIncidents = serializedIncidents ? JSON.parse(serializedIncidents) as SpillIncident[] : null;
    const incidents = Array.isArray(savedIncidents) && savedIncidents.length > 0 ? savedIncidents : MOCK_INCIDENTS;
    const selectedIncidentId = window.localStorage.getItem(SELECTED_INCIDENT_STORAGE_KEY);
    return {
      incidents,
      selectedIncident: incidents.find((incident) => incident.id === selectedIncidentId) || incidents[0],
    };
  } catch {
    return { incidents: MOCK_INCIDENTS, selectedIncident: MOCK_INCIDENTS[0] };
  }
}

export default function App() {
  const [initialAppState] = useState(loadInitialAppState);
  const [showIntro, setShowIntro] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<NavTabType>('dashboard');
  const [incidents, setIncidents] = useState<SpillIncident[]>(initialAppState.incidents);
  const [selectedIncident, setSelectedIncident] = useState<SpillIncident>(initialAppState.selectedIncident);
  
  // Theme and UI accessibility mode state
  const [currentTheme, setCurrentTheme] = useState<ThemeMode>('cyber');
  const [isPlainEnglish, setIsPlainEnglish] = useState<boolean>(false);
  const [isHowItWorksOpen, setIsHowItWorksOpen] = useState<boolean>(false);
  const [isThemeSettingsOpen, setIsThemeSettingsOpen] = useState<boolean>(false);

  // Court dossier modal state
  const [dossierState, setDossierState] = useState<{
    isOpen: boolean;
    incident: SpillIncident | null;
    vessel: CorrelatedVessel | null;
  }>({
    isOpen: false,
    incident: null,
    vessel: null,
  });

  // AI Chat Assistant drawer state
  const [isAiOpen, setIsAiOpen] = useState<boolean>(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(INCIDENTS_STORAGE_KEY, JSON.stringify(incidents));
    } catch (error) {
      console.warn('Unable to persist OilTrace incidents in this browser.', error);
    }
  }, [incidents]);

  useEffect(() => {
    try {
      window.localStorage.setItem(SELECTED_INCIDENT_STORAGE_KEY, selectedIncident.id);
    } catch (error) {
      console.warn('Unable to persist the selected OilTrace incident.', error);
    }
  }, [selectedIncident]);

  const handleOpenDossier = (incident: SpillIncident, vessel: CorrelatedVessel) => {
    setDossierState({
      isOpen: true,
      incident,
      vessel,
    });
  };

  const handleInjectCustomIncident = (newIncident: SpillIncident) => {
    setIncidents((prev) => [newIncident, ...prev]);
    setSelectedIncident(newIncident);
  };

  const handleTransferSatelliteToInvestigation = async (
    customData: Partial<SpillIncident> & { elapsedHours?: number },
  ) => {
    if (customData.detectionId && customData.coordinates && customData.maskGeometry) {
      const [latitude, longitude] = customData.coordinates;
      const detectedAt = new Date().toISOString();
      const elapsedHours = customData.elapsedHours ?? 10.4;
      const metoceanResponse = await fetch('/api/v1/drift/hindcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude, longitude, timestamp: detectedAt, elapsed_hours: elapsedHours }),
      });
      if (!metoceanResponse.ok) throw new Error('Unable to retrieve the metocean provider response');
      const metoceanPayload = await metoceanResponse.json();
      const metocean = metoceanFromVectors(
        metoceanPayload.wind,
        metoceanPayload.current,
        metoceanPayload.data_source,
      );
      const driftResult = runDeterministicDriftModel(
        latitude,
        longitude,
        detectedAt,
        metocean,
        elapsedHours,
        24,
      );
      const aisResponse = await fetch('/api/v1/vessels/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          latitude: driftResult.originLat,
          longitude: driftResult.originLon,
          timestamp: driftResult.estimatedReleaseTimeUtc,
          radius_km: 50,
        }),
      });
      if (!aisResponse.ok) throw new Error('Unable to retrieve the AIS provider response');
      const aisPayload = await aisResponse.json();
      const candidates = candidatesFromAisRecords(aisPayload.vessels as AisTrackRecord[]);
      const correlatedVessels = rankVesselsByAttribution(candidates, driftResult);
      const confidence = customData.confidence ?? 0;
      const newIncident: SpillIncident = {
        id: customData.detectionId,
        name: customData.name || `Uploaded SAR detection ${customData.detectionId}`,
        locationName: `Georeferenced image center (${latitude.toFixed(5)}, ${longitude.toFixed(5)})`,
        coordinates: [latitude, longitude],
        detectedAt,
        satelliteSource: 'User-uploaded SAR image',
        sarPolarization: 'Unspecified',
        slickType: 'Unclassified',
        areaKm2: customData.areaKm2 ?? 0,
        estimatedVolumeBbl: 0,
        volumeEstimateAvailable: false,
        thicknessMicrons: 0,
        confidence,
        biogenicConfidence: 0,
        status: 'UNDER_INVESTIGATION',
        priority: confidence >= 90 ? 'CRITICAL' : confidence >= 70 ? 'HIGH' : 'ELEVATED',
        hindcastOrigin: {
          lat: driftResult.originLat,
          lon: driftResult.originLon,
          estimatedReleaseTimeUtc: driftResult.estimatedReleaseTimeUtc,
          elapsedHours,
          driftDistanceNm: driftResult.driftDistanceNm,
          uncertaintyRadiusKm: driftResult.uncertaintyRadiusKm,
        },
        metocean,
        radarBackscatterDb: 0,
        radarDampingRatio: 0,
        correlatedVessels,
        notes: 'Preliminary U-Net result. Drift inputs and AIS tracks are synthetic development data; no vessel attribution is implied.',
        detectionId: customData.detectionId,
        maskAreaRatio: customData.maskAreaRatio,
        maskGeometry: customData.maskGeometry,
        imageFootprint: customData.imageFootprint,
        groundSampleDistanceM: customData.groundSampleDistanceM,
        inferenceMode: customData.inferenceMode,
        driftResult,
        metoceanProvider: metoceanPayload.data_source,
        aisProvider: aisPayload.data_source,
        attributionDisclaimer: ATTRIBUTION_DISCLAIMER,
      };
      setIncidents((previous) => [newIncident, ...previous.filter((incident) => incident.id !== newIncident.id)]);
      setSelectedIncident(newIncident);
      setActiveTab('investigation');
      return;
    }

    const updated: SpillIncident = {
      ...selectedIncident,
      name: customData.name || selectedIncident.name,
      coordinates: customData.coordinates || selectedIncident.coordinates,
      areaKm2: customData.areaKm2 ?? selectedIncident.areaKm2,
      estimatedVolumeBbl: customData.estimatedVolumeBbl ?? selectedIncident.estimatedVolumeBbl,
      confidence: customData.confidence ?? selectedIncident.confidence,
      radarBackscatterDb: customData.radarBackscatterDb ?? selectedIncident.radarBackscatterDb,
    };
    setSelectedIncident(updated);
    setActiveTab('investigation');
  };

  const themeClass = `theme-${currentTheme}`;

  return (
    <div className={`min-h-screen bg-[var(--bg-main)] text-[var(--text-main)] flex flex-col relative selection:bg-[#00f2ff] selection:text-[#002022] ${themeClass} transition-colors duration-300`}>
      
      {/* Pre-Opening Satellite Radar Initialization Animation */}
      <AnimatePresence mode="wait">
        {showIntro && (
          <IntroLoadingAnimation
            onComplete={() => setShowIntro(false)}
            isPlainEnglish={isPlainEnglish}
            onTogglePlainEnglish={() => setIsPlainEnglish((prev) => !prev)}
          />
        )}
      </AnimatePresence>

      {/* Ambient Canvas & Scanline */}
      <div className="fixed inset-0 z-[-2] bg-[var(--bg-main)]" />
      <div className="fixed inset-0 z-[-1] bg-grid opacity-30 pointer-events-none" />
      <div className="scanline" />

      {/* Top Fixed Tactical Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        incidents={incidents}
        selectedIncident={selectedIncident}
        setSelectedIncident={setSelectedIncident}
        onOpenAiAssistant={() => setIsAiOpen(true)}
        onOpenSimulation={() => setActiveTab('simulation')}
        onOpenHowItWorks={() => setIsHowItWorksOpen(true)}
        onOpenThemeSettings={() => setIsThemeSettingsOpen(true)}
        isPlainEnglish={isPlainEnglish}
        onTogglePlainEnglish={() => setIsPlainEnglish((prev) => !prev)}
        currentTheme={currentTheme}
        onSelectTheme={(t) => setCurrentTheme(t)}
        onReplayIntro={() => setShowIntro(true)}
      />

      {/* Main Content Area */}
      <main className="flex-grow pt-16 flex flex-col relative z-10 w-full overflow-hidden">
        {activeTab === 'dashboard' && (
          <>
            <HeroSection
              onLaunchInvestigation={() => setActiveTab('investigation')}
              onExploreDemo={() => setActiveTab('satellite')}
              incidents={incidents}
              selectedIncident={selectedIncident}
              onSelectIncident={(inc) => {
                setSelectedIncident(inc);
                setActiveTab('investigation');
              }}
              isPlainEnglish={isPlainEnglish}
              onReplayIntro={() => setShowIntro(true)}
            />
            <IntelligenceBentoGrid
              incidents={incidents}
              onSelectIncident={setSelectedIncident}
              onOpenInvestigation={() => setActiveTab('investigation')}
              onOpenAnalytics={() => setActiveTab('analytics')}
              isPlainEnglish={isPlainEnglish}
            />
          </>
        )}

        {activeTab === 'satellite' && (
          <SatelliteAnalysisView
            onTransferToInvestigation={handleTransferSatelliteToInvestigation}
            isPlainEnglish={isPlainEnglish}
          />
        )}

        {activeTab === 'investigation' && (
          <InvestigationTheater
            incidents={incidents}
            selectedIncident={selectedIncident}
            onSelectIncident={setSelectedIncident}
            onGenerateDossier={handleOpenDossier}
            isPlainEnglish={isPlainEnglish}
          />
        )}

        {activeTab === 'analytics' && (
          <AnalyticsDashboard
            incidents={incidents}
            selectedIncident={selectedIncident}
            isPlainEnglish={isPlainEnglish}
          />
        )}

        {activeTab === 'system' && (
          <SystemStatus isPlainEnglish={isPlainEnglish} />
        )}

        {activeTab === 'simulation' && (
          <SimulationStudio
            onInjectCustomIncident={handleInjectCustomIncident}
            onOpenInvestigation={() => setActiveTab('investigation')}
            isPlainEnglish={isPlainEnglish}
          />
        )}
      </main>

      {/* Persistent Footer */}
      <Footer
        onOpenHowItWorks={() => setIsHowItWorksOpen(true)}
        isPlainEnglish={isPlainEnglish}
        onSelectTab={setActiveTab}
      />

      {/* Modals & Slide-out Drawers */}
      <CourtDossierModal
        isOpen={dossierState.isOpen}
        onClose={() => setDossierState({ isOpen: false, incident: null, vessel: null })}
        incident={dossierState.incident}
        vessel={dossierState.vessel}
        isPlainEnglish={isPlainEnglish}
      />

      <AiAnalystDrawer
        isOpen={isAiOpen}
        onClose={() => setIsAiOpen(false)}
        activeIncident={selectedIncident}
        activeVessel={selectedIncident.correlatedVessels[0] || null}
      />

      <HowItWorksModal
        isOpen={isHowItWorksOpen}
        onClose={() => setIsHowItWorksOpen(false)}
        isPlainEnglish={isPlainEnglish}
        onOpenDemo={() => {
          setIsHowItWorksOpen(false);
          setActiveTab('investigation');
        }}
      />

      <ThemeSettingsModal
        isOpen={isThemeSettingsOpen}
        onClose={() => setIsThemeSettingsOpen(false)}
        currentTheme={currentTheme}
        onSelectTheme={setCurrentTheme}
        isPlainEnglish={isPlainEnglish}
        onTogglePlainEnglish={() => setIsPlainEnglish((prev) => !prev)}
      />

    </div>
  );
}
