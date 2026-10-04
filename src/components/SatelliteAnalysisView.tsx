import React, { useState } from 'react';
import { 
  Upload, 
  Satellite, 
  Sparkles, 
  Layers, 
  Sliders, 
  CheckCircle2, 
  AlertTriangle, 
  Eye, 
  Maximize2, 
  RefreshCw, 
  ArrowRight,
  ShieldCheck,
  Zap,
  Activity,
  Droplet,
  Compass
} from 'lucide-react';
import { PRELOADED_SAR_SCENES, SarTestScene, cvService } from '../services/satelliteCvService';
import { buildAiPipeline } from '../services/aiPipeline';
import { loadDetectionHistory, saveDetectionResult } from '../services/detectionStore';
import type { StoredDetectionResult } from '../services/detectionStore';
import { CvDetectionMetrics, GeoJsonMultiPolygonGeometry, GeoJsonPolygonGeometry, SpillIncident } from '../types';

interface SatelliteAnalysisViewProps {
  onTransferToInvestigation: (customIncident: Partial<SpillIncident> & { elapsedHours?: number }) => void | Promise<void>;
  isPlainEnglish?: boolean;
}

export const SatelliteAnalysisView: React.FC<SatelliteAnalysisViewProps> = ({
  onTransferToInvestigation,
  isPlainEnglish = false,
}) => {
  const [selectedScene, setSelectedScene] = useState<SarTestScene>(PRELOADED_SAR_SCENES[0]);
  const [activeViewerTab, setActiveViewerTab] = useState<'ORIGINAL' | 'PREPROCESSED' | 'MASK' | 'OVERLAY'>('OVERLAY');
  const [isProcessing, setIsProcessing] = useState(false);
  const [customFile, setCustomFile] = useState<File | null>(null);
  const [customFilePreview, setCustomFilePreview] = useState<string | null>(null);
  const [latitudeInput, setLatitudeInput] = useState('');
  const [longitudeInput, setLongitudeInput] = useState('');
  const [groundSampleDistanceInput, setGroundSampleDistanceInput] = useState('');
  const [elapsedHoursInput, setElapsedHoursInput] = useState('10.4');
  const [inferenceError, setInferenceError] = useState<string | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [recentDetections, setRecentDetections] = useState<StoredDetectionResult[]>(loadDetectionHistory);
  const [lastDetection, setLastDetection] = useState<{
    detectionId: string;
    maskUrl: string;
    maskAreaRatio: number;
    areaKm2: number | null;
    location: { latitude: number; longitude: number } | null;
    geometry: GeoJsonMultiPolygonGeometry | null;
    imageFootprint: GeoJsonPolygonGeometry | null;
    groundSampleDistanceM: number | null;
    modelName: string;
    inferenceMode: string;
    isDemo: boolean;
    confidenceIsCalibrated: boolean;
  } | null>(null);

  const [cvResult, setCvResult] = useState<CvDetectionMetrics>({
    spillDetected: true,
    confidence: selectedScene.expectedConfidence,
    estimatedAreaKm2: selectedScene.expectedAreaKm2,
    perimeterKm: selectedScene.expectedPerimeterKm,
    centroidLatLon: selectedScene.coordinates,
    boundingBox: { minLat: 56.338, maxLat: 56.498, minLon: 3.104, maxLon: 3.344 },
    thicknessMicrons: 4.2,
    estimatedVolumeBbl: selectedScene.expectedVolumeBbl,
    radarBackscatterDb: selectedScene.radarBackscatterDb,
    radarDampingRatio: selectedScene.dampingRatio,
    biogenicAlgaeProbability: selectedScene.biogenicProb,
    lowWindFalseAlarmProbability: 1.4,
    imageQualityScore: 98.2,
    snrRatioDb: 14.6,
    algorithmName: 'OilTrace-SAR-UNet-v3 (Demo inference pipeline)',
    architectureType: 'Dilated Residual U-Net with Spatial Attention Gates',
    originalImageUrl: selectedScene.originalImageUrl,
    preprocessedImageUrl: selectedScene.preprocessedImageUrl,
    segmentationMaskUrl: selectedScene.segmentationMaskUrl,
    overlayImageUrl: selectedScene.overlayImageUrl,
  });

  const aiPipeline = buildAiPipeline(selectedScene);

  const handleSelectPreset = (scene: SarTestScene) => {
    setSelectedScene(scene);
    setCustomFile(null);
    setCustomFilePreview(null);
    setLastDetection(null);
    setInferenceError(null);
    setCvResult({
      spillDetected: true,
      confidence: scene.expectedConfidence,
      estimatedAreaKm2: scene.expectedAreaKm2,
      perimeterKm: scene.expectedPerimeterKm,
      centroidLatLon: scene.coordinates,
      boundingBox: {
        minLat: Number((scene.coordinates[0] - 0.08).toFixed(4)),
        maxLat: Number((scene.coordinates[0] + 0.08).toFixed(4)),
        minLon: Number((scene.coordinates[1] - 0.12).toFixed(4)),
        maxLon: Number((scene.coordinates[1] + 0.12).toFixed(4)),
      },
      thicknessMicrons: 4.2,
      estimatedVolumeBbl: scene.expectedVolumeBbl,
      radarBackscatterDb: scene.radarBackscatterDb,
      radarDampingRatio: scene.dampingRatio,
      biogenicAlgaeProbability: scene.biogenicProb,
      lowWindFalseAlarmProbability: 1.4,
      imageQualityScore: 98.2,
      snrRatioDb: 14.6,
      algorithmName: 'OilTrace-SAR-UNet-v3 (Demo inference pipeline)',
      architectureType: 'Dilated Residual U-Net with Spatial Attention Gates',
      originalImageUrl: scene.originalImageUrl,
      preprocessedImageUrl: scene.preprocessedImageUrl,
      segmentationMaskUrl: scene.segmentationMaskUrl,
      overlayImageUrl: scene.overlayImageUrl,
    });
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setCustomFile(file);
      const url = URL.createObjectURL(file);
      setCustomFilePreview(url);
      setLastDetection(null);
      setInferenceError(null);
    }
  };

  const handleRunInference = async () => {
    if (!customFile) {
      setInferenceError('Upload an image before running detection.');
      return;
    }
    setIsProcessing(true);
    setInferenceError(null);
    try {
      const imageBase64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Unable to read image'));
        reader.onerror = () => reject(new Error('Unable to read image'));
        reader.readAsDataURL(customFile);
      });
      const latitude = Number(latitudeInput);
      const longitude = Number(longitudeInput);
      const groundSampleDistance = Number(groundSampleDistanceInput);
      const hasGeoreferencing = latitudeInput !== ''
        && longitudeInput !== ''
        && groundSampleDistanceInput !== ''
        && Number.isFinite(latitude)
        && Number.isFinite(longitude)
        && Number.isFinite(groundSampleDistance)
        && latitude >= -90
        && latitude <= 90
        && longitude >= -180
        && longitude <= 180
        && groundSampleDistance > 0;
      const res = await fetch('/api/v1/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: imageBase64,
          ...(hasGeoreferencing && {
            latitude,
            longitude,
            ground_sample_distance_m: groundSampleDistance,
          }),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || 'Detection request failed');
      const detection = data.detection;
      const maskUrl = `data:image/png;base64,${detection.segmentation_mask_base64}`;
      const confidencePercent = Number((detection.confidence * 100).toFixed(1));
      setLastDetection({
        detectionId: data.detection_id,
        maskUrl,
        maskAreaRatio: detection.mask_area_ratio,
        areaKm2: detection.area_km2,
        location: data.location,
        geometry: data.geometry,
        imageFootprint: data.image_footprint,
        groundSampleDistanceM: data.ground_sample_distance_m,
        modelName: data.model_name,
        inferenceMode: data.inference_mode,
        isDemo: data.is_demo,
        confidenceIsCalibrated: detection.confidence_is_calibrated,
      });
      const storedDetection: StoredDetectionResult = {
        detectionId: data.detection_id,
        createdAt: new Date().toISOString(),
        imageName: customFile.name,
        modelName: data.model_name,
        inferenceMode: data.inference_mode,
        isDemo: data.is_demo,
        spillDetected: detection.oil_spill_detected,
        confidence: detection.confidence,
        confidenceIsCalibrated: detection.confidence_is_calibrated,
        maskAreaRatio: detection.mask_area_ratio,
        areaKm2: detection.area_km2,
        location: data.location,
        groundSampleDistanceM: data.ground_sample_distance_m,
        geometry: data.geometry,
        imageFootprint: data.image_footprint,
        maskPngDataUrl: maskUrl,
      };
      setRecentDetections(saveDetectionResult(storedDetection));
      setActiveViewerTab('MASK');
      setCvResult((prev) => ({
        ...prev,
        spillDetected: detection.oil_spill_detected,
        confidence: confidencePercent,
        estimatedAreaKm2: detection.area_km2 ?? 0,
        estimatedVolumeBbl: 0,
        algorithmName: data.model_name,
        architectureType: data.inference_mode,
        originalImageUrl: customFilePreview || prev.originalImageUrl,
        segmentationMaskUrl: maskUrl,
        overlayImageUrl: customFilePreview || prev.overlayImageUrl,
      }));
    } catch (err) {
      setInferenceError(err instanceof Error ? err.message : 'Detection request failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSendToInvestigation = async () => {
    if (
      !lastDetection
      || !cvResult.spillDetected
      || !lastDetection.location
      || !lastDetection.geometry?.coordinates.length
      || lastDetection.areaKm2 == null
    ) return;
    const elapsedHours = Number(elapsedHoursInput);
    if (!Number.isFinite(elapsedHours) || elapsedHours <= 0) {
      setInferenceError('Enter a positive estimated time before detection in hours.');
      return;
    }
    setIsTransferring(true);
    setInferenceError(null);
    try {
      await onTransferToInvestigation({
        detectionId: lastDetection.detectionId,
        name: `Uploaded SAR detection ${lastDetection.detectionId}`,
        coordinates: [lastDetection.location.latitude, lastDetection.location.longitude],
        areaKm2: cvResult.estimatedAreaKm2,
        estimatedVolumeBbl: cvResult.estimatedVolumeBbl,
        confidence: cvResult.confidence,
        maskAreaRatio: lastDetection.maskAreaRatio,
        maskGeometry: lastDetection.geometry,
        imageFootprint: lastDetection.imageFootprint || undefined,
        groundSampleDistanceM: lastDetection.groundSampleDistanceM || undefined,
        inferenceMode: lastDetection.inferenceMode,
        elapsedHours,
      });
    } catch (error) {
      setInferenceError(error instanceof Error ? error.message : 'Unable to build the investigation from this detection');
    } finally {
      setIsTransferring(false);
    }
  };

  // Get active image for viewer based on active tab
  const getActiveDisplayImage = () => {
    switch (activeViewerTab) {
      case 'ORIGINAL':
        return customFilePreview || cvResult.originalImageUrl;
      case 'PREPROCESSED':
        return cvResult.preprocessedImageUrl;
      case 'MASK':
        return lastDetection?.maskUrl || cvResult.segmentationMaskUrl;
      case 'OVERLAY':
      default:
        return customFilePreview || cvResult.overlayImageUrl;
    }
  };

  return (
    <div className="w-full min-h-[calc(100vh-64px)] p-4 sm:p-6 lg:p-10 bg-[#0e1320] text-[#dee2f4] space-y-8">
      
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between pb-6 border-b border-[#3a494b] gap-4">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded border border-[#00f2ff]/30 bg-[#00f2ff]/10 text-xs font-mono-data text-[#00f2ff] uppercase tracking-wider mb-2 font-bold">
            <Satellite className="w-3.5 h-3.5" />
            <span>Synthetic Aperture Radar (SAR) Computer Vision Studio</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold uppercase tracking-tight text-[#dee2f4]">
            Satellite Remote Sensing & Slick Segmentation
          </h1>
          <p className="text-sm text-[#b9cacb] mt-1 max-w-3xl">
            Inversion of Bragg capillary wave damping on ocean surface using multi-scale U-Net deep learning and Lee speckle filtering.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRunInference}
            disabled={isProcessing}
            className="btn-primary px-4 py-2 rounded-lg text-xs font-mono-data font-bold flex items-center gap-2"
          >
            <Zap className={`w-4 h-4 ${isProcessing ? 'animate-spin' : ''}`} />
            <span>{isProcessing ? 'INVERTING SAR BACKSCATTER...' : 'RUN CV INFERENCE PIPELINE'}</span>
          </button>
        </div>
      </div>
      {inferenceError && <div role="alert" className="text-sm text-red-300">{inferenceError}</div>}
      {lastDetection && (
        <div className={`text-xs font-mono-data ${lastDetection.isDemo ? 'text-amber-300' : 'text-[#b9cacb]'}`}>
          {lastDetection.isDemo ? 'DEMO HEURISTIC, NOT A TRAINED MODEL' : `MODEL: ${lastDetection.modelName}`}
          {' · '}{lastDetection.confidenceIsCalibrated ? 'calibrated confidence' : 'uncalibrated model score'}
        </div>
      )}

      <section className="grid grid-cols-1 sm:grid-cols-5 gap-3 p-4 border border-[#3a494b] rounded-lg bg-[#0e1320]">
        <div className="sm:col-span-4">
          <h2 className="text-xs font-mono-data font-bold text-[#00f2ff] uppercase">Image georeferencing</h2>
          <p className="text-[11px] text-[#849495] mt-1">Enter the image-center coordinates and source-image pixel size to map the mask and calculate area. Assumes north-up imagery.</p>
        </div>
        <label className="text-xs text-[#b9cacb]">Center latitude
          <input type="number" min="-90" max="90" step="any" value={latitudeInput} onChange={(event) => setLatitudeInput(event.target.value)} className="mt-1 block w-full rounded border border-[#3a494b] bg-[#141c2c] px-2 py-2 text-sm text-white" placeholder="e.g. 18.5214" />
        </label>
        <label className="text-xs text-[#b9cacb]">Center longitude
          <input type="number" min="-180" max="180" step="any" value={longitudeInput} onChange={(event) => setLongitudeInput(event.target.value)} className="mt-1 block w-full rounded border border-[#3a494b] bg-[#141c2c] px-2 py-2 text-sm text-white" placeholder="e.g. 72.8422" />
        </label>
        <label className="text-xs text-[#b9cacb]">Ground sample distance (m/px)
          <input type="number" min="0" step="any" value={groundSampleDistanceInput} onChange={(event) => setGroundSampleDistanceInput(event.target.value)} className="mt-1 block w-full rounded border border-[#3a494b] bg-[#141c2c] px-2 py-2 text-sm text-white" placeholder="e.g. 10" />
        </label>
        <label className="text-xs text-[#b9cacb]">Estimated spill age (hours)
          <input type="number" min="0.1" step="0.1" value={elapsedHoursInput} onChange={(event) => setElapsedHoursInput(event.target.value)} className="mt-1 block w-full rounded border border-[#3a494b] bg-[#141c2c] px-2 py-2 text-sm text-white" />
        </label>
        <div className="sm:col-span-5 text-[11px] text-[#849495]">Center/GSD are required for polygon placement and area. Spill age is an operator-supplied hindcast assumption.</div>
        {recentDetections.length > 0 && (
          <details className="sm:col-span-5 text-xs text-[#b9cacb]">
            <summary className="cursor-pointer text-[#00f2ff]">Recent stored detections ({recentDetections.length})</summary>
            <ul className="mt-2 max-h-36 overflow-y-auto space-y-1">
              {recentDetections.slice(0, 8).map((result) => (
                <li key={result.detectionId}>
                  {result.createdAt} · {result.imageName} · {result.spillDetected ? 'mask predicted' : 'no mask pixels'} · {(result.maskAreaRatio * 100).toFixed(2)}% coverage{result.areaKm2 == null ? '' : ` · ${result.areaKm2} km²`}
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* Preset SAR Scenes Selector */}
      <div>
        <h2 className="text-xs font-mono-data text-[#849495] uppercase tracking-widest mb-3 flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-[#00f2ff]" />
          BENCHMARK SAR TEST SCENES (COPERNICUS & COMMERCIAL CONSTELLATIONS)
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PRELOADED_SAR_SCENES.map((scene) => {
            const isSelected = selectedScene.id === scene.id;
            return (
              <button
                key={scene.id}
                onClick={() => handleSelectPreset(scene)}
                className={`text-left p-4 rounded-xl border transition-all flex flex-col justify-between ${
                  isSelected
                    ? 'bg-[#1a2336] border-[#00f2ff] shadow-[0_0_20px_rgba(0,242,255,0.2)]'
                    : 'bg-[#121a2a] border-[#3a494b] hover:border-[#00f2ff]/50'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-mono-data text-[#00f2ff] font-bold">{scene.satellite}</span>
                    <span className="text-[10px] font-mono-data px-1.5 py-0.5 rounded bg-[#0e1320] text-[#b9cacb] border border-[#3a494b]">
                      {scene.polarization}
                    </span>
                  </div>
                  <h3 className="text-sm font-bold text-[#dee2f4] line-clamp-1">{scene.name}</h3>
                  <p className="text-xs text-[#849495] mt-1">{scene.locationName}</p>
                </div>
                <div className="mt-3 pt-2 border-t border-[#3a494b]/60 flex items-center justify-between text-xs font-mono-data">
                  <span className="text-[#b9cacb]">Area: {scene.expectedAreaKm2} km²</span>
                  <span className="text-emerald-400 font-bold">{scene.expectedConfidence}% Conf</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Analysis Workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: Interactive Image Comparison Viewer (8 Cols) */}
        <div className="lg:col-span-8 space-y-4">
          <div className="glass-panel-elevated rounded-xl p-5 border border-[#3a494b] space-y-4">
            
            {/* Viewer Mode Navigation Tabs */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-[#3a494b]">
              <div className="flex items-center gap-1.5 p-1 rounded-lg bg-[#0e1320] border border-[#3a494b]">
                {[
                  { key: 'ORIGINAL', label: '1. Original SAR' },
                  { key: 'PREPROCESSED', label: '2. Lee Filtered' },
                  { key: 'MASK', label: '3. Binary Mask' },
                  { key: 'OVERLAY', label: '4. AI Overlay' },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveViewerTab(tab.key as any)}
                    className={`px-3 py-1.5 rounded-md text-xs font-mono-data font-bold transition-all ${
                      activeViewerTab === tab.key
                        ? 'bg-[#00f2ff] text-[#002022] shadow-[0_0_12px_rgba(0,242,255,0.4)]'
                        : 'text-[#849495] hover:text-[#dee2f4]'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Upload Custom SAR Button */}
              <label className="cursor-pointer inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1a2336] text-[#00f2ff] border border-[#00f2ff]/40 hover:bg-[#00f2ff]/10 text-xs font-mono-data transition-all">
                <Upload className="w-3.5 h-3.5" />
                <span>Upload SAR (PNG/JPG/GeoTIFF)</span>
                <input type="file" accept="image/*,.tif,.tiff" onChange={handleFileUpload} className="hidden" />
              </label>
            </div>

            {/* Image Canvas Display Area */}
            <div className="relative w-full h-[420px] rounded-lg overflow-hidden border border-[#3a494b] bg-[#070b14] flex items-center justify-center">
              <img
                src={getActiveDisplayImage()}
                alt="SAR Analysis"
                className="w-full h-full object-cover"
                referrerPolicy="no-referrer"
              />

              {/* High-Tech Overlay Elements when OVERLAY is active */}
              {activeViewerTab === 'OVERLAY' && !lastDetection && (
                <div className="absolute inset-0 pointer-events-none p-6 flex flex-col justify-between">
                  
                  {/* Bounding Box Crosshairs */}
                  <div className="border border-[#00f2ff]/60 bg-[#00f2ff]/10 rounded p-3 w-48 backdrop-blur-sm">
                    <div className="text-[10px] font-mono-data text-[#00f2ff] font-bold">SEGMENTATION REGION 01</div>
                    <div className="text-xs font-mono-data text-white">
                      {lastDetection?.areaKm2 == null
                        ? `Mask coverage: ${(lastDetection ? lastDetection.maskAreaRatio * 100 : 0).toFixed(2)}%`
                        : `Area: ${lastDetection.areaKm2} km²`}
                    </div>
                    <div className="text-[10px] font-mono-data text-[#849495]">Confidence: {cvResult.confidence}%</div>
                  </div>

                  {/* Centroid Crosshair in center */}
                  <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex items-center justify-center">
                    <div className="w-12 h-12 border border-[#ef4444] rounded-full animate-ping opacity-60" />
                    <div className="absolute w-2 h-2 bg-[#ef4444] rounded-full" />
                    <div className="absolute top-7 bg-[#0e1320]/90 px-2 py-0.5 rounded text-[10px] font-mono-data text-[#ef4444] border border-[#ef4444]/40 whitespace-nowrap">
                      Centroid: {cvResult.centroidLatLon[0]}°N, {cvResult.centroidLatLon[1]}°E
                    </div>
                  </div>

                  {/* Image HUD corner brackets */}
                  <div className="self-end text-right bg-[#0e1320]/90 p-2 rounded border border-[#3a494b] text-[10px] font-mono-data text-[#b9cacb]">
                    <div>SENSOR: {selectedScene.sensor}</div>
                    <div>POL: {selectedScene.polarization}</div>
                    <div>RES: {selectedScene.resolution}</div>
                  </div>
                </div>
              )}

              {/* Processing Spinner Overlay */}
              {isProcessing && (
                <div className="absolute inset-0 bg-[#0e1320]/80 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
                  <RefreshCw className="w-8 h-8 text-[#00f2ff] animate-spin" />
                  <span className="text-xs font-mono-data text-[#00f2ff] uppercase tracking-wider font-bold">
                    Running Multi-Scale U-Net Convolutional Inversion...
                  </span>
                </div>
              )}
            </div>

            {/* Architecture Notice Banner */}
            <div className="p-3 rounded-lg bg-[#141c2c] border border-[#3a494b] flex items-center justify-between text-xs font-mono-data">
              <div className="flex items-center gap-2 text-[#849495]">
                <Activity className="w-4 h-4 text-[#00f2ff]" />
                <span>
                  MODEL: <b className="text-[#dee2f4]">{lastDetection?.modelName || 'Preset demonstration'}</b>
                  {lastDetection ? ` (${lastDetection.inferenceMode})` : ' (results below are demo data)'}
                </span>
              </div>
              <span className="text-emerald-400 font-bold">{lastDetection ? 'API RESULT' : 'DEMO'}</span>
            </div>

            {/* AI Pipeline Summary */}
            {lastDetection ? (
              <div className="p-4 rounded-xl border border-[#00f2ff]/30 bg-[#0f172a] space-y-3">
                <div className="text-[10px] font-mono-data text-[#00f2ff] uppercase font-bold">Uploaded image detection</div>
                <div className="text-sm text-[#dee2f4]">
                  {cvResult.spillDetected ? 'Mask contains predicted slick pixels.' : 'No slick pixels passed the current threshold.'}
                </div>
                <div className="text-xs text-[#b9cacb]">
                  Mask coverage: {(lastDetection.maskAreaRatio * 100).toFixed(2)}%. Physical area requires the image ground footprint.
                  {' '}The model score is {lastDetection.confidenceIsCalibrated ? 'calibrated.' : 'not calibrated.'}
                </div>
              </div>
            ) : (
            <div className="p-4 rounded-xl border border-[#00f2ff]/30 bg-[#0f172a] space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[10px] font-mono-data text-[#00f2ff] uppercase tracking-[0.2em] font-bold">AI pipeline summary</div>
                <div className="px-2 py-1 rounded-full border border-emerald-400/30 bg-emerald-500/10 text-[10px] font-mono-data text-emerald-300">
                  {aiPipeline.detection.spillDetected ? 'SPILL DETECTED' : 'NO SPILL'}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs font-mono-data">
                <div className="rounded-lg bg-[#111827] border border-[#3a494b] p-3">
                  <div className="text-[#849495]">Detection</div>
                  <div className="text-lg font-bold text-[#dee2f4] mt-1">{aiPipeline.detection.confidence}%</div>
                </div>
                <div className="rounded-lg bg-[#111827] border border-[#3a494b] p-3">
                  <div className="text-[#849495]">Severity</div>
                  <div className="text-lg font-bold text-[#fbbf24] mt-1">{aiPipeline.severity.label}</div>
                </div>
                <div className="rounded-lg bg-[#111827] border border-[#3a494b] p-3">
                  <div className="text-[#849495]">Area</div>
                  <div className="text-lg font-bold text-[#00f2ff] mt-1">{aiPipeline.segmentation.areaKm2.toFixed(1)} km²</div>
                </div>
                <div className="rounded-lg bg-[#111827] border border-[#3a494b] p-3">
                  <div className="text-[#849495]">Risk</div>
                  <div className="text-lg font-bold text-[#f87171] mt-1">{aiPipeline.environmentalRisk.overall}/100</div>
                </div>
              </div>

              <div className="text-xs text-[#b9cacb] leading-relaxed">
                {aiPipeline.summary}
              </div>
            </div>
            )}

          </div>
        </div>

        {/* Right Column: Spill Characterisation & Telemetry Metrics (4 Cols) */}
        <div className="lg:col-span-4 space-y-4">
          <div className="glass-panel-elevated rounded-xl p-5 border border-[#3a494b] space-y-5">
            <div className="flex items-center justify-between pb-3 border-b border-[#3a494b]">
              <span className="text-xs font-mono-data font-bold text-[#00f2ff] uppercase">Detected Spill Metrics</span>
              <span className="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/30 text-[10px] font-mono-data font-bold">
                {lastDetection ? (cvResult.spillDetected ? 'MODEL PREDICTION' : 'NO SLICK PREDICTED') : 'DEMO SCENE'}
              </span>
            </div>

            {/* Metric Grid */}
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-lg bg-[#0e1320] border border-[#3a494b]">
                <div className="text-[10px] font-mono-data text-[#849495]">{lastDetection ? (lastDetection.areaKm2 == null ? 'MASK COVERAGE' : 'SPILL AREA') : 'DEMO AREA'}</div>
                <div className="text-xl font-bold font-mono-data text-[#00f2ff] mt-1">
                  {lastDetection?.areaKm2 == null
                    ? `${(lastDetection ? lastDetection.maskAreaRatio * 100 : 0).toFixed(2)}%`
                    : `${lastDetection.areaKm2} km²`}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[#0e1320] border border-[#3a494b]">
                <div className="text-[10px] font-mono-data text-[#849495]">{lastDetection ? 'VOLUME' : 'DEMO VOLUME'}</div>
                <div className="text-xl font-bold font-mono-data text-[#dee2f4] mt-1">
                  {lastDetection ? 'Not estimated' : `~${cvResult.estimatedVolumeBbl} bbl`}
                </div>
              </div>

              <div className="p-3 rounded-lg bg-[#0e1320] border border-[#3a494b]">
                <div className="text-[10px] font-mono-data text-[#849495]">{lastDetection ? 'MODEL' : 'RADAR DAMPING'}</div>
                <div className="text-xl font-bold font-mono-data text-[#ef4444] mt-1">{lastDetection ? lastDetection.modelName : `${cvResult.radarBackscatterDb} dB`}</div>
              </div>

              <div className="p-3 rounded-lg bg-[#0e1320] border border-[#3a494b]">
                <div className="text-[10px] font-mono-data text-[#849495]">{lastDetection ? 'MODEL SCORE' : 'DETECTION CONFIDENCE'}</div>
                <div className="text-xl font-bold font-mono-data text-emerald-400 mt-1">{cvResult.confidence}%</div>
              </div>
            </div>

            {!lastDetection && <>
            {/* False-Positive Discrimination Engine */}
            <div className="p-3.5 rounded-lg bg-[#0e1320] border border-[#3a494b] space-y-2.5">
              <div className="text-[11px] font-mono-data font-bold text-[#b9cacb] uppercase flex items-center justify-between">
                <span>False-Positive Filters</span>
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
              </div>

              <div className="space-y-2 text-xs font-mono-data">
                <div className="flex items-center justify-between">
                  <span className="text-[#849495]">Biogenic Algae Bloom:</span>
                  <span className="text-emerald-400 font-bold">{cvResult.biogenicAlgaeProbability}% (Ruled Out)</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-[#1e293b] overflow-hidden">
                  <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${cvResult.biogenicAlgaeProbability}%` }} />
                </div>

                <div className="flex items-center justify-between pt-1">
                  <span className="text-[#849495]">Low-Wind Calm Sea Error:</span>
                  <span className="text-emerald-400 font-bold">{cvResult.lowWindFalseAlarmProbability}% (Ruled Out)</span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-[#1e293b] overflow-hidden">
                  <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${cvResult.lowWindFalseAlarmProbability}%` }} />
                </div>
              </div>
            </div>
            </>}

            {/* Characterization Summary */}
            <div className="p-3 rounded-lg bg-[#141c2c] border border-[#3a494b] text-xs space-y-1.5">
              {lastDetection ? (
                <>
                  <div className="text-[10px] font-mono-data text-[#00f2ff] font-bold uppercase">Image Metadata</div>
                  <p className="text-[#b9cacb]">{customFile?.name}</p>
                  <p className="text-[#849495] text-[11px]">This image has no georeferenced footprint or physical spill characterization in the detection response.</p>
                </>
              ) : (
                <>
                  <div className="text-[10px] font-mono-data text-[#00f2ff] font-bold uppercase">Physical Profile · Demo</div>
                  <p className="text-[#dee2f4]"><b>Classification:</b> {selectedScene.slickType}</p>
                  <p className="text-[#b9cacb]"><b>Centroid:</b> {cvResult.centroidLatLon[0]}°N, {cvResult.centroidLatLon[1]}°E</p>
                  <p className="text-[#849495] text-[11px]">Bragg wave resonance damping ratio of {cvResult.radarDampingRatio}x confirms thick surface hydrocarbon film.</p>
                </>
              )}
            </div>

            {/* Transfer to Investigation Theater Button */}
            <button
              onClick={handleSendToInvestigation}
              disabled={isTransferring || Boolean(lastDetection && (
                !cvResult.spillDetected
                || !lastDetection.location
                || !lastDetection.geometry?.coordinates.length
                || lastDetection.areaKm2 == null
              ))}
              title={lastDetection && !lastDetection.geometry?.coordinates.length ? 'This prediction contains no spill polygon to transfer.' : undefined}
              className="w-full btn-ghost p-3 rounded-lg text-xs font-mono-data font-bold flex items-center justify-center gap-2"
            >
              <span>{isTransferring ? 'FETCHING PROVIDER DATA & BUILDING INVESTIGATION...' : lastDetection ? (cvResult.spillDetected ? 'SEND GEOREFERENCED DETECTION TO INVESTIGATION' : 'NO SPILL PREDICTED') : 'SEND TO INVESTIGATION THEATER'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>

          </div>
        </div>

      </div>

    </div>
  );
};
