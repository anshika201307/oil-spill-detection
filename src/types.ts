export type InvestigationTab = 'dashboard' | 'investigation' | 'satellite-analysis' | 'simulation' | 'analytics' | 'system';

export type PipelineStage = 
  | 'QUEUED' 
  | 'INGESTING_SATELLITE' 
  | 'PREPROCESSING_CV' 
  | 'DETECTING_SLICK' 
  | 'CHARACTERISING_SPILL' 
  | 'ENVIRONMENTAL_FUSION' 
  | 'DRIFT_RECONSTRUCTION' 
  | 'AIS_CORRELATION' 
  | 'VESSEL_RANKING' 
  | 'COMPLETE';

export interface MetoceanData {
  windSpeedKts: number;
  windDirectionDeg: number;
  surfaceCurrentSpeedMs: number;
  surfaceCurrentDirDeg: number;
  seaSurfaceTempC: number;
  waveHeightM: number;
  seaState?: string;
  source?: string;
}

export interface DriftWaypoint {
  lat: number;
  lon: number;
  timeUtc: string;
  stepHours: number;
  windSpeedKts: number;
  currentSpeedMs: number;
  uncertaintyRadiusKm: number;
}

export interface DriftSimulationResult {
  originLat: number;
  originLon: number;
  estimatedReleaseTimeUtc: string;
  elapsedHours: number;
  driftDistanceNm: number;
  confidence: number;
  uncertaintyRadiusKm: number;
  backwardWaypoints: DriftWaypoint[];
  forwardWaypoints: DriftWaypoint[];
  driftVectorBearingDeg: number;
  driftSpeedKnots: number;
  leewayFactorUsed: number;
}

export interface CvDetectionMetrics {
  spillDetected: boolean;
  confidence: number;
  estimatedAreaKm2: number;
  perimeterKm: number;
  centroidLatLon: [number, number];
  boundingBox: {
    minLat: number;
    maxLat: number;
    minLon: number;
    maxLon: number;
  };
  thicknessMicrons: number;
  estimatedVolumeBbl: number;
  radarBackscatterDb: number;
  radarDampingRatio: number;
  biogenicAlgaeProbability: number;
  lowWindFalseAlarmProbability: number;
  imageQualityScore: number;
  snrRatioDb: number;
  algorithmName: string;
  architectureType: string;
  originalImageUrl: string;
  preprocessedImageUrl: string;
  segmentationMaskUrl: string;
  overlayImageUrl: string;
}

export interface AisScoreBreakdown {
  spatialScore: number;       // Proximity to backward drift origin & trajectory (0-100)
  temporalScore: number;      // Timestamp discrepancy (0-100)
  trajectoryScore: number;    // Intersection / course alignment with plume corridor (0-100)
  driftCompatibilityScore: number; // Kinematics vs drift vector + draft change (0-100)
  aisConfidenceScore: number; // Data continuity vs blackout penalty (0-100)
  overallScore: number;       // Weighted composite (0-100)
  weightsUsed: {
    spatial: number;
    temporal: number;
    trajectory: number;
    drift: number;
    confidence: number;
  };
  explanationBullets: string[];
  investigativeRank: number;
}

export interface CorrelatedVessel {
  id: string;
  name: string;
  mmsi: string;
  imo: string;
  callsign: string;
  flag: string;
  flagCode: string;
  vesselType: 'Crude Oil Tanker' | 'Bulk Carrier' | 'Container Ship' | 'Chemical Tanker' | 'Product Tanker' | 'General Cargo' | 'Offshore Supply' | 'Fishing Vessel' | 'Tug / Tow';
  lengthM: number;
  beamM: number;
  draftM: number;
  draftChangeM: number; // e.g. -0.65m
  speedKnots: number;
  courseOverGround: number;
  distanceAtOriginNm: number;
  timeDeviationMinutes: number;
  attributionScore: number; // 0-100%
  aisStatus: 'NORMAL' | 'ANOMALOUS_BLACKOUT' | 'SPEED_DISCREPANCY' | 'SPOOFING_DETECTED' | 'DRAFT_REDUCTION';
  ownerCompany: string;
  registeredPort: string;
  destination: string;
  eta: string;
  suspectedAction: string;
  trackCoordinates: { 
    lat: number; 
    lon: number; 
    timeUtc: string; 
    speedKts: number; 
    courseDeg: number; 
    draftM?: number; 
  }[];
  scoreBreakdown?: AisScoreBreakdown;
}

export interface SpillIncident {
  id: string;
  name: string;
  locationName: string;
  coordinates: [number, number]; // [lat, lon]
  detectedAt: string;
  satelliteSource: string;
  sarPolarization: 'VV + VH' | 'HH + HV' | 'Quad-Pol' | 'Dual-Pol VV';
  slickType: 'Heavy Fuel Oil (HFO)' | 'Crude Oil (API 32°)' | 'Bilge Slop / Oily Water' | 'Refined Marine Gas Oil';
  areaKm2: number;
  estimatedVolumeBbl: number;
  thicknessMicrons: number;
  confidence: number;
  biogenicConfidence: number; // low means false positive ruled out
  status: 'ACTIVE_DRIFT' | 'UNDER_INVESTIGATION' | 'ATTRIBUTED' | 'CONTAINMENT_DEPLOYED';
  priority: 'CRITICAL' | 'HIGH' | 'ELEVATED';
  hindcastOrigin: {
    lat: number;
    lon: number;
    estimatedReleaseTimeUtc: string;
    elapsedHours: number;
    driftDistanceNm: number;
    uncertaintyRadiusKm?: number;
  };
  metocean: MetoceanData;
  radarBackscatterDb: number;
  radarDampingRatio: number;
  correlatedVessels: CorrelatedVessel[];
  notes: string;
  sarImageUrl?: string;
  cvAnalysis?: CvDetectionMetrics;
  driftResult?: DriftSimulationResult;
}

export interface SatelliteMission {
  id: string;
  name: string;
  constellation: 'Copernicus' | 'DLR' | 'ASI' | 'HISDESAT' | 'CONAE' | 'Capella';
  orbitType: 'Sun-Synchronous Polar' | 'Dawn-Dusk SSO' | 'LEO High Inclination';
  altitudeKm: number;
  sensor: 'C-band SAR' | 'X-band SAR' | 'L-band SAR' | 'Multi-Spectral Optical';
  resolutionM: number;
  swathWidthKm: number;
  nextPassTarget: string;
  nextPassInMinutes: number;
  downlinkStatus: 'LOCKED' | 'DOWNLINKING' | 'ACQUIRING' | 'STANDBY';
  telemetryHealth: number; // 0-100%
}

export interface IncidentDossier {
  dossierId: string;
  timestampUtc: string;
  caseStatus: 'OFFICIAL_ADMIRALTY_BRIEF' | 'PRELIMINARY_EVIDENCE' | 'FLAG_STATE_NOTIFICATION';
  incidentId: string;
  vesselId: string;
  confidenceScore: number;
  chainOfCustodyHash: string;
  satelliteSignatures: {
    polarimetricContrast: string;
    slickAreaExpansion: string;
    thicknessEstimation: string;
  };
  hydrodynamicDriftValidation: string;
  aisTrajectoryCorrelation: string;
  legalConclusion: string;
  actionItems: string[];
}
