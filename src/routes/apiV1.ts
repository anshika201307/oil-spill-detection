import { randomUUID } from 'node:crypto';
import { Request, Response, Router } from 'express';
import { PoolClient } from 'pg';
import { pool } from '../config/database';
import { CorrelatedVessel, DriftSimulationResult, MetoceanData } from '../types';
import { DEFAULT_CORRELATION_WEIGHTS, rankVesselsByAttribution } from '../services/aisCorrelationEngine';
import { calculateHaversineDistanceNm, runDeterministicDriftModel } from '../services/driftModel';

const router = Router();
const DISCLAIMER = 'Scores represent investigative leads, not proof that a vessel caused an oil spill.';

type Handler = (req: Request, res: Response) => Promise<void> | void;
type JsonObject = Record<string, unknown>;

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

function endpoint(handler: Handler) {
  return (req: Request, res: Response) => {
    void Promise.resolve(handler(req, res)).catch((error: unknown) => {
      if (error instanceof ApiError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      const message = error instanceof Error && error.message.trim()
        ? error.message
        : 'Request failed; verify PostgreSQL is available and check the server configuration';
      console.error('[API v1] Request failed:', message);
      res.status(500).json({ error: 'Request failed', message });
    });
  };
}

function objectBody(value: unknown): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'Request body must be a JSON object');
  }
  return value as JsonObject;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ApiError(400, `${field} is required`);
  }
  return value.trim();
}

function finiteNumber(value: unknown, field: string, min?: number, max?: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || (min !== undefined && parsed < min) || (max !== undefined && parsed > max)) {
    throw new ApiError(400, `${field} must be a finite number${min !== undefined && max !== undefined ? ` between ${min} and ${max}` : ''}`);
  }
  return parsed;
}

function asDate(value: unknown, field: string, fallback?: Date): Date {
  if (value === undefined || value === null || value === '') {
    if (fallback) return fallback;
    throw new ApiError(400, `${field} is required`);
  }
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new ApiError(400, `${field} must be a valid date`);
  return date;
}

function coordinates(body: JsonObject): { latitude: number; longitude: number } {
  const pair = Array.isArray(body.coordinates) ? body.coordinates : [];
  return {
    latitude: finiteNumber(body.latitude ?? body.lat ?? pair[0], 'latitude', -90, 90),
    longitude: finiteNumber(body.longitude ?? body.lon ?? pair[1], 'longitude', -180, 180),
  };
}

function incidentValues(body: JsonObject) {
  const { latitude, longitude } = coordinates(body);
  const detectedAt = asDate(body.detectedAt, 'detectedAt', new Date());
  return {
    incidentCode: typeof body.incidentCode === 'string' && body.incidentCode.trim()
      ? body.incidentCode.trim()
      : `OT-${randomUUID()}`,
    name: requiredText(body.name, 'name'),
    locationName: typeof body.locationName === 'string' ? body.locationName : '',
    latitude,
    longitude,
    detectedAt,
    satelliteSource: typeof body.satelliteSource === 'string' ? body.satelliteSource : 'Unknown',
    slickType: typeof body.slickType === 'string' ? body.slickType : 'Unclassified',
    areaKm2: finiteNumber(body.areaKm2 ?? 0, 'areaKm2', 0),
    confidence: finiteNumber(body.confidence ?? 0, 'confidence', 0, 100),
    status: typeof body.status === 'string' ? body.status : 'UNDER_INVESTIGATION',
    metadata: JSON.stringify(body.metadata ?? {}),
  };
}

function incidentIdFromParam(value: string): string {
  if (!/^\d+$/.test(value) || BigInt(value) <= 0n) {
    throw new ApiError(400, 'Incident id must be a positive BIGINT value');
  }
  return value;
}

function mmsiFromValue(value: unknown): string {
  const mmsi = requiredText(typeof value === 'number' ? String(value) : value, 'mmsi');
  if (!/^\d{1,9}$/.test(mmsi) || BigInt(mmsi) <= 0n) {
    throw new ApiError(400, 'mmsi must be a positive BIGINT MMSI');
  }
  return mmsi;
}

function normalizeTrackPoint(value: unknown) {
  const point = objectBody(value);
  const { latitude, longitude } = coordinates(point);
  return {
    latitude,
    longitude,
    observedAt: asDate(point.timeUtc ?? point.observedAt, 'track point timeUtc'),
    speedKnots: finiteNumber(point.speedKts ?? point.speedKnots ?? 0, 'speedKts', 0),
    courseDeg: finiteNumber(point.courseDeg ?? 0, 'courseDeg', 0, 359.999),
    draftM: point.draftM === undefined || point.draftM === null ? null : finiteNumber(point.draftM, 'draftM', 0),
    dataQuality: point.dataQuality === undefined ? null : finiteNumber(point.dataQuality, 'dataQuality', 0, 100),
  };
}

async function upsertVessel(client: PoolClient, incidentId: string, value: unknown) {
  const body = objectBody(value);
  const mmsi = mmsiFromValue(body.mmsi ?? body.vesselId);
  const name = requiredText(body.name, 'vessel name');
  const pointsInput = body.trackCoordinates ?? body.trackPoints ?? [];
  if (!Array.isArray(pointsInput)) throw new ApiError(400, `AIS track for ${mmsi} must be an array`);
  const points = pointsInput.map(normalizeTrackPoint);
  const metadata = { ...body };
  delete metadata.trackCoordinates;
  delete metadata.trackPoints;

  await client.query(
    `INSERT INTO vessels (mmsi, name, imo, callsign, vessel_type, flag, ais_status, current_draft_m, metadata, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, NOW())
     ON CONFLICT (mmsi) DO UPDATE SET name = EXCLUDED.name, imo = EXCLUDED.imo,
       callsign = EXCLUDED.callsign, vessel_type = EXCLUDED.vessel_type, flag = EXCLUDED.flag,
       ais_status = EXCLUDED.ais_status, current_draft_m = EXCLUDED.current_draft_m,
       metadata = EXCLUDED.metadata, updated_at = NOW()
     RETURNING id`,
    [mmsi, name, body.imo ?? null, body.callsign ?? null, body.vesselType ?? null, body.flag ?? null,
      body.aisStatus ?? null, body.draftM ?? null, JSON.stringify(metadata)]
  );
  const vesselId = String((await client.query('SELECT id FROM vessels WHERE mmsi = $1', [mmsi])).rows[0].id);

  for (const point of points) {
    const values = [incidentId, mmsi, point.observedAt, point.latitude, point.longitude, point.speedKnots,
      point.courseDeg, point.draftM, point.dataQuality, vesselId];
    const existingPoint = await client.query(
      'SELECT id FROM ais_track_points WHERE incident_id = $1 AND mmsi = $2 AND observed_at = $3 ORDER BY id LIMIT 1',
      values.slice(0, 3)
    );
    if (existingPoint.rowCount) {
      await client.query(
        `UPDATE ais_track_points SET latitude = $1, longitude = $2, speed_kts = $3, speed_knots = $3,
          heading_deg = $4, course_deg = $4, draft_m = $5, data_quality = $6
         WHERE id = $7`,
        [point.latitude, point.longitude, point.speedKnots, point.courseDeg, point.draftM,
          point.dataQuality, String(existingPoint.rows[0].id)]
      );
    } else {
      await client.query(
        `INSERT INTO ais_track_points
          (vessel_id, incident_id, mmsi, recorded_at, observed_at, latitude, longitude,
           speed_kts, speed_knots, heading_deg, course_deg, draft_m, data_quality)
         VALUES ($10, $1, $2, $3, $3, $4, $5, $6, $6, $7, $7, $8, $9)`,
        values
      );
    }
  }

  return { id: vesselId, mmsi, name, trackPointsStored: points.length };
}

function metoceanFrom(value: unknown): MetoceanData {
  const metocean = objectBody(value);
  return {
    windSpeedKts: finiteNumber(metocean.windSpeedKts, 'metocean.windSpeedKts', 0),
    windDirectionDeg: finiteNumber(metocean.windDirectionDeg, 'metocean.windDirectionDeg', 0, 360),
    surfaceCurrentSpeedMs: finiteNumber(metocean.surfaceCurrentSpeedMs, 'metocean.surfaceCurrentSpeedMs', 0),
    surfaceCurrentDirDeg: finiteNumber(metocean.surfaceCurrentDirDeg, 'metocean.surfaceCurrentDirDeg', 0, 360),
    seaSurfaceTempC: finiteNumber(metocean.seaSurfaceTempC ?? 0, 'metocean.seaSurfaceTempC'),
    waveHeightM: finiteNumber(metocean.waveHeightM ?? 0, 'metocean.waveHeightM', 0),
    seaState: typeof metocean.seaState === 'string' ? metocean.seaState : undefined,
    source: typeof metocean.source === 'string' ? metocean.source : undefined,
  };
}

async function findIncident(id: string) {
  const result = await pool.query(
    `SELECT i.*,
       (SELECT to_jsonb(d) FROM spill_detections d WHERE d.incident_id = i.id ORDER BY d.created_at DESC LIMIT 1) AS latest_detection,
       (SELECT to_jsonb(r) FROM drift_results r WHERE r.incident_id = i.id ORDER BY r.created_at DESC LIMIT 1) AS latest_drift
     FROM incidents i WHERE i.id = $1`,
    [id]
  );
  if (!result.rowCount) throw new ApiError(404, `Incident ${id} was not found`);
  return result.rows[0];
}

async function createDriftResult(incidentId: string, incident: JsonObject, body: JsonObject) {
  const detection = incident.latest_detection as JsonObject | null;
  const detectedLat = finiteNumber(body.latitude ?? detection?.centroid_latitude ?? incident.latitude, 'latitude', -90, 90);
  const detectedLon = finiteNumber(body.longitude ?? detection?.centroid_longitude ?? incident.longitude, 'longitude', -180, 180);
  const detectedAt = asDate(body.detectedAt ?? detection?.detected_at ?? incident.detected_at, 'detectedAt');
  const metocean = metoceanFrom(body.metocean);
  const elapsedHours = finiteNumber(body.elapsedHours ?? 10.4, 'elapsedHours', 0, 720);
  const forwardHours = finiteNumber(body.forwardHours ?? 24, 'forwardHours', 0, 720);
  const drift = runDeterministicDriftModel(detectedLat, detectedLon, detectedAt.toISOString(), metocean, elapsedHours, forwardHours);
  const inserted = await pool.query(
    `INSERT INTO drift_results
       (incident_id, origin_latitude, origin_longitude, estimated_release_time, elapsed_hours,
        drift_distance_nm, confidence, uncertainty_radius_km, drift_bearing_deg, drift_speed_kts,
        leeway_factor, result)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)
     RETURNING id`,
    [incidentId, drift.originLat, drift.originLon, drift.estimatedReleaseTimeUtc, drift.elapsedHours,
      drift.driftDistanceNm, drift.confidence, drift.uncertaintyRadiusKm, drift.driftVectorBearingDeg,
      drift.driftSpeedKnots, drift.leewayFactorUsed, JSON.stringify(drift)]
  );
  return { id: inserted.rows[0].id as string | number, drift };
}

function vesselFromRow(row: JsonObject): CorrelatedVessel {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as JsonObject : {};
  const trackPoints = Array.isArray(row.track_points) ? row.track_points as JsonObject[] : [];
  const vesselType = String(row.vessel_type || metadata.vesselType || 'Unknown') as CorrelatedVessel['vesselType'];
  return {
    id: String(row.id),
    name: String(row.name),
    mmsi: String(row.mmsi),
    imo: String(row.imo || ''),
    callsign: String(row.callsign || ''),
    flag: String(row.flag || ''),
    flagCode: String(metadata.flagCode || ''),
    vesselType,
    lengthM: Number(metadata.lengthM || 0),
    beamM: Number(metadata.beamM || 0),
    draftM: Number(metadata.draftM || 0),
    draftChangeM: Number(metadata.draftChangeM || 0),
    speedKnots: Number(metadata.speedKnots || 0),
    courseOverGround: Number(metadata.courseOverGround || 0),
    distanceAtOriginNm: 0,
    timeDeviationMinutes: 0,
    attributionScore: 0,
    aisStatus: (metadata.aisStatus || 'NORMAL') as CorrelatedVessel['aisStatus'],
    ownerCompany: String(metadata.ownerCompany || ''),
    registeredPort: String(metadata.registeredPort || ''),
    destination: String(metadata.destination || ''),
    eta: String(metadata.eta || ''),
    suspectedAction: String(metadata.suspectedAction || ''),
    trackCoordinates: trackPoints.map((point) => ({
      lat: Number(point.latitude),
      lon: Number(point.longitude),
      timeUtc: new Date(String(point.observed_at)).toISOString(),
      speedKts: Number(point.speed_knots),
      courseDeg: Number(point.course_deg),
      ...(point.draft_m === null ? {} : { draftM: Number(point.draft_m) }),
    })),
  };
}

function applyDataQuality(vessel: CorrelatedVessel, source: JsonObject): CorrelatedVessel {
  if (!vessel.scoreBreakdown) return vessel;
  const requestedQuality = Number(source.dataQualityScore ?? source.confidence);
  const quality = Number.isFinite(requestedQuality)
    ? Math.max(0, Math.min(100, requestedQuality <= 1 ? requestedQuality * 100 : requestedQuality))
    : Math.min(95, 60 + vessel.trackCoordinates.length * 5);
  const breakdown = vessel.scoreBreakdown;
  breakdown.aisConfidenceScore = Math.round(breakdown.aisConfidenceScore * 0.7 + quality * 0.3);
  const weights = breakdown.weightsUsed;
  breakdown.overallScore = Number((
    breakdown.spatialScore * weights.spatial + breakdown.temporalScore * weights.temporal +
    breakdown.trajectoryScore * weights.trajectory + breakdown.driftCompatibilityScore * weights.drift +
    breakdown.aisConfidenceScore * weights.confidence
  ).toFixed(1));
  return { ...vessel, attributionScore: breakdown.overallScore };
}

function withoutTrack(vessel: CorrelatedVessel): CorrelatedVessel {
  const breakdown = {
    spatialScore: 0,
    temporalScore: 0,
    trajectoryScore: 0,
    driftCompatibilityScore: 0,
    aisConfidenceScore: 0,
    overallScore: 0,
    weightsUsed: DEFAULT_CORRELATION_WEIGHTS,
    explanationBullets: ['Insufficient AIS track data to calculate a vessel correlation.'],
    investigativeRank: 0,
  };
  return { ...vessel, attributionScore: 0, scoreBreakdown: breakdown };
}

async function persistRankings(client: PoolClient, incidentId: string, driftResultId: number | string, vessels: CorrelatedVessel[]) {
  for (const [index, vessel] of vessels.entries()) {
    const breakdown = vessel.scoreBreakdown;
    if (!breakdown) continue;
    breakdown.investigativeRank = index + 1;
    await client.query(
      `INSERT INTO vessel_correlations
        (incident_id, vessel_id, drift_result_id, spatial_score, temporal_score, trajectory_score,
         drift_compatibility_score, ais_confidence_score, overall_score, investigative_score,
         investigative_rank, rank, explanation_bullets, component_breakdown, calculated_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $10, $11::jsonb, $12::jsonb, NOW(), NOW())
       ON CONFLICT (incident_id, vessel_id) DO UPDATE SET drift_result_id = EXCLUDED.drift_result_id,
         spatial_score = EXCLUDED.spatial_score, temporal_score = EXCLUDED.temporal_score,
         trajectory_score = EXCLUDED.trajectory_score, drift_compatibility_score = EXCLUDED.drift_compatibility_score,
         ais_confidence_score = EXCLUDED.ais_confidence_score, overall_score = EXCLUDED.overall_score,
         investigative_score = EXCLUDED.investigative_score, investigative_rank = EXCLUDED.investigative_rank,
         rank = EXCLUDED.rank, explanation_bullets = EXCLUDED.explanation_bullets,
         component_breakdown = EXCLUDED.component_breakdown, calculated_at = NOW(), updated_at = NOW()`,
      [incidentId, vessel.id, driftResultId, breakdown.spatialScore, breakdown.temporalScore,
        breakdown.trajectoryScore, breakdown.driftCompatibilityScore, breakdown.aisConfidenceScore,
        vessel.attributionScore, index + 1, JSON.stringify(breakdown.explanationBullets), JSON.stringify(breakdown)]
    );
  }
}

async function scoreStoredVessels(incidentId: string, drift: DriftSimulationResult, driftResultId: number | string) {
  const rows = await pool.query(
     `SELECT v.*, COALESCE(json_agg(json_build_object(
       'latitude', p.latitude, 'longitude', p.longitude, 'observed_at', p.observed_at,
       'speed_knots', p.speed_knots, 'course_deg', p.course_deg, 'draft_m', p.draft_m
     ) ORDER BY p.observed_at) FILTER (WHERE p.id IS NOT NULL), '[]'::json) AS track_points
      FROM vessels v LEFT JOIN ais_track_points p ON p.vessel_id = v.id AND p.incident_id = $1
      WHERE EXISTS (SELECT 1 FROM ais_track_points t WHERE t.vessel_id = v.id AND t.incident_id = $1)
        OR v.id IN (SELECT vessel_id FROM vessel_correlations WHERE incident_id = $1)
      GROUP BY v.id`,
    [incidentId]
  );
  const all = rows.rows.map((row) => vesselFromRow(row as JsonObject));
  const trackable = all.filter((vessel) => vessel.trackCoordinates.length > 0);
  const sourceByMmsi = new Map(rows.rows.map((row) => [String(row.mmsi), row.metadata as JsonObject || {}]));
  const rankedWithTracks = rankVesselsByAttribution(trackable, drift)
    .map((vessel) => applyDataQuality(vessel, sourceByMmsi.get(vessel.mmsi) || {}));
  const rankedWithoutTracks = all.filter((vessel) => vessel.trackCoordinates.length === 0).map(withoutTrack);
  const ranked = [...rankedWithTracks, ...rankedWithoutTracks]
    .sort((a, b) => b.attributionScore - a.attributionScore || a.mmsi.localeCompare(b.mmsi));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await persistRankings(client, incidentId, driftResultId, ranked);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return ranked;
}

router.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'oiltrace-api', timestamp: new Date().toISOString() });
});

router.get('/db/health', endpoint(async (_req, res) => {
  try {
    const result = await pool.query('SELECT current_database() AS database, NOW() AS checked_at');
    res.json({ status: 'connected', ...result.rows[0] });
  } catch (error) {
    const message = error instanceof Error && error.message.trim()
      ? error.message
      : 'Unable to connect; verify PostgreSQL is running and DB_HOST/DB_PORT are correct';
    res.status(503).json({ status: 'unavailable', error: 'PostgreSQL connection failed', message });
  }
}));

router.get('/incidents', endpoint(async (_req, res) => {
  const result = await pool.query('SELECT * FROM incidents ORDER BY detected_at DESC, id DESC');
  res.json({ incidents: result.rows });
}));

router.post('/incidents', endpoint(async (req, res) => {
  const values = incidentValues(objectBody(req.body));
  const result = await pool.query(
    `INSERT INTO incidents
       (incident_code, name, location_name, latitude, longitude, detected_at, satellite_source,
        spill_type, slick_type, area_km2, confidence, status, metadata, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::varchar, $8::varchar, $9, $10, $11, $12::jsonb, NOW()) RETURNING *`,
    [values.incidentCode, values.name, values.locationName, values.latitude, values.longitude, values.detectedAt,
      values.satelliteSource, values.slickType, values.areaKm2, values.confidence, values.status, values.metadata]
  );
  res.status(201).json({ incident: result.rows[0] });
}));

router.get('/incidents/:id', endpoint(async (req, res) => {
  res.json({ incident: await findIncident(incidentIdFromParam(req.params.id)) });
}));

router.post('/incidents/:id/drift', endpoint(async (req, res) => {
  const incidentId = incidentIdFromParam(req.params.id);
  const incident = await findIncident(incidentId) as JsonObject;
  const result = await createDriftResult(incidentId, incident, objectBody(req.body));
  res.status(201).json({ incidentId, driftResultId: result.id, drift: result.drift });
}));

router.post('/incidents/:id/vessels', endpoint(async (req, res) => {
  const incidentId = incidentIdFromParam(req.params.id);
  await findIncident(incidentId);
  const body = objectBody(req.body);
  if (!Array.isArray(body.vessels) || body.vessels.length === 0) {
    throw new ApiError(400, 'vessels must be a non-empty array');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stored = [];
    for (const vessel of body.vessels) {
      const candidate = await upsertVessel(client, incidentId, vessel);
      stored.push(candidate);
      await client.query(
        `INSERT INTO vessel_correlations
          (incident_id, vessel_id, overall_score, investigative_score, investigative_rank, rank, component_breakdown, explanation_bullets)
         VALUES ($1, $2, 0, 0, 2147483647, 2147483647, $3::jsonb, $4::jsonb)
         ON CONFLICT (incident_id, vessel_id) DO NOTHING`,
        [incidentId, candidate.id, JSON.stringify({ pending: true, reason: 'Awaiting ranking; AIS data may be insufficient.' }),
          JSON.stringify(['Awaiting ranking; AIS data may be insufficient.'])]
      );
    }
    await client.query('COMMIT');
    res.status(201).json({ incidentId, vessels: stored });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

router.get('/incidents/:id/ranking', endpoint(async (req, res) => {
  const incidentId = incidentIdFromParam(req.params.id);
  const incident = await findIncident(incidentId) as JsonObject;
  const latest = incident.latest_drift as JsonObject | null;
  if (!latest) throw new ApiError(409, 'No drift result exists for this incident; create one before requesting vessel ranking');
  const drift = (latest.result || {
    originLat: Number(latest.origin_latitude),
    originLon: Number(latest.origin_longitude),
    estimatedReleaseTimeUtc: new Date(String(latest.estimated_release_time)).toISOString(),
    elapsedHours: Number(latest.elapsed_hours || 0),
    driftDistanceNm: Number(latest.drift_distance_nm || 0),
    confidence: Number(latest.confidence || 0),
    uncertaintyRadiusKm: Number(latest.uncertainty_radius_km || 0),
    backwardWaypoints: [],
    forwardWaypoints: [],
    driftVectorBearingDeg: Number(latest.drift_bearing_deg || 0),
    driftSpeedKnots: Number(latest.drift_speed_kts || 0),
    leewayFactorUsed: Number(latest.leeway_factor || 0),
  }) as DriftSimulationResult;
  const ranked = await scoreStoredVessels(incidentId, drift, latest.id as number | string);
  res.json({ incidentId, totalCandidates: ranked.length, disclaimer: DISCLAIMER, candidates: ranked });
}));

function offsetCoordinate(lat: number, lon: number, distanceNm: number, bearingDeg: number) {
  const bearing = bearingDeg * Math.PI / 180;
  const deltaLat = distanceNm * Math.cos(bearing) / 60;
  const deltaLon = distanceNm * Math.sin(bearing) / (60 * Math.cos(lat * Math.PI / 180));
  return { lat: Number((lat + deltaLat).toFixed(6)), lon: Number((lon + deltaLon).toFixed(6)) };
}

router.post('/demo/seed', endpoint(async (_req, res) => {
  const incidentCode = 'OT-DEMO-001';
  const detectedAt = new Date('2026-08-25T18:39:00.000Z');
  const latitude = 56.418;
  const longitude = 3.224;
  const metocean: MetoceanData = {
    windSpeedKts: 21.4,
    windDirectionDeg: 310,
    surfaceCurrentSpeedMs: 0.94,
    surfaceCurrentDirDeg: 135,
    seaSurfaceTempC: 14.2,
    waveHeightM: 1.4,
    source: 'Deterministic synthetic demo data',
  };
  const drift = runDeterministicDriftModel(latitude, longitude, detectedAt.toISOString(), metocean, 10.4, 24);
  const releaseMs = new Date(drift.estimatedReleaseTimeUtc).getTime();
  const demoVessels = [
    {
      mmsi: '235081944', name: 'MT Stena Nautica', imo: '9234567', callsign: 'STNA', vesselType: 'Crude Oil Tanker', flag: 'United Kingdom', oiltraceDemo: true,
      draftChangeM: -0.65, aisStatus: 'ANOMALOUS_BLACKOUT', confidence: 94,
      trackCoordinates: [-30, 0, 30].map((minutes, index) => {
        const point = offsetCoordinate(drift.originLat, drift.originLon, index === 1 ? 0 : 0.22, index === 1 ? 0 : 90);
        return { ...point, timeUtc: new Date(releaseMs + minutes * 60000).toISOString(), speedKts: index === 1 ? 7.8 : 10.2, courseDeg: 135, draftM: 8.35, dataQuality: 92 };
      }),
    },
    {
      mmsi: '636019842', name: 'MV Northwind', imo: '9412345', callsign: 'NTHW', vesselType: 'Bulk Carrier', flag: 'Liberia', oiltraceDemo: true,
      draftChangeM: 0, aisStatus: 'NORMAL', confidence: 82,
      trackCoordinates: [-30, 0, 30].map((minutes) => {
        const point = offsetCoordinate(drift.originLat, drift.originLon, 3.2, 45);
        return { ...point, timeUtc: new Date(releaseMs + minutes * 60000).toISOString(), speedKts: 13.4, courseDeg: 225, draftM: 9.1, dataQuality: 86 };
      }),
    },
    {
      mmsi: '244710221', name: 'Baltic Meridian', imo: '9567890', callsign: 'BLMD', vesselType: 'Container Ship', flag: 'Netherlands', oiltraceDemo: true,
      draftChangeM: 0, aisStatus: 'NORMAL', confidence: 75,
      trackCoordinates: [-30, 0, 30].map((minutes) => {
        const point = offsetCoordinate(drift.originLat, drift.originLon, 8.5, 270);
        return { ...point, timeUtc: new Date(releaseMs + minutes * 60000).toISOString(), speedKts: 16.1, courseDeg: 90, draftM: 10.4, dataQuality: 76 };
      }),
    },
  ];

  const client = await pool.connect();
  let incidentId: string;
  let driftResultId: number | string;
  try {
    await client.query('BEGIN');
    const insertedIncident = await client.query(
      `INSERT INTO incidents
        (incident_code, name, location_name, detected_at, latitude, longitude, satellite_source,
         spill_type, slick_type, area_km2, confidence, status, metadata, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::varchar, $8::varchar, $9, $10, $11, $12::jsonb, NOW())
       ON CONFLICT (incident_code) DO NOTHING RETURNING id`,
      [incidentCode, 'North Sea Bravo Sector Oil Spill', 'North Sea EEZ Bravo', detectedAt, latitude, longitude,
        'Sentinel-1A SAR (synthetic)', 'Crude Oil (API 32°)', 44.8, 96.4, 'UNDER_INVESTIGATION', JSON.stringify({ demo: true })]
    );
    if (insertedIncident.rowCount) {
      incidentId = String(insertedIncident.rows[0].id);
    } else {
      const existingIncident = await client.query(
        `SELECT id, COALESCE(metadata->>'demo', 'false') AS is_demo
         FROM incidents WHERE incident_code = $1 FOR UPDATE`,
        [incidentCode]
      );
      if (!existingIncident.rowCount || existingIncident.rows[0].is_demo !== 'true') {
        throw new ApiError(409, `Incident code ${incidentCode} is already assigned to a non-demo record`);
      }
      incidentId = String(existingIncident.rows[0].id);
      await client.query(
        `UPDATE incidents SET name = $2, location_name = $3, detected_at = $4, latitude = $5, longitude = $6,
          satellite_source = $7, spill_type = $8::varchar, slick_type = $8::varchar, area_km2 = $9, confidence = $10,
          status = $11, metadata = $12::jsonb, updated_at = NOW() WHERE id = $1`,
        [incidentId, 'North Sea Bravo Sector Oil Spill', 'North Sea EEZ Bravo', detectedAt, latitude, longitude,
          'Sentinel-1A SAR (synthetic)', 'Crude Oil (API 32°)', 44.8, 96.4, 'UNDER_INVESTIGATION', JSON.stringify({ demo: true })]
      );
    }

    const conflictingVessels = await client.query(
      `SELECT mmsi FROM vessels WHERE mmsi = ANY($1::bigint[])
         AND COALESCE(metadata->>'oiltraceDemo', 'false') <> 'true'`,
      [demoVessels.map((vessel) => vessel.mmsi)]
    );
    if (conflictingVessels.rowCount) {
      throw new ApiError(409, 'A demo MMSI is already assigned to a non-demo vessel; no vessel record was changed');
    }

    const detection = await client.query(
      'SELECT id FROM spill_detections WHERE incident_id = $1 AND detected_at = $2 ORDER BY id LIMIT 1',
      [incidentId, detectedAt]
    );
    if (detection.rowCount) {
      await client.query(
        `UPDATE spill_detections SET centroid_latitude = $2, centroid_longitude = $3, area_km2 = $4,
          confidence = $5, detection_payload = $6::jsonb WHERE id = $1`,
        [String(detection.rows[0].id), latitude, longitude, 44.8, 96.4, JSON.stringify({ synthetic: true, sensor: 'SAR' })]
      );
    } else {
      await client.query(
        `INSERT INTO spill_detections
          (incident_id, detected_at, centroid_latitude, centroid_longitude, area_km2, confidence, detection_payload)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
        [incidentId, detectedAt, latitude, longitude, 44.8, 96.4, JSON.stringify({ synthetic: true, sensor: 'SAR' })]
      );
    }

    const existingDrift = await client.query(
      'SELECT id FROM drift_results WHERE incident_id = $1 AND estimated_release_time = $2 ORDER BY id LIMIT 1',
      [incidentId, drift.estimatedReleaseTimeUtc]
    );
    if (existingDrift.rowCount) {
      driftResultId = String(existingDrift.rows[0].id);
      await client.query(
        `UPDATE drift_results SET origin_latitude = $2, origin_longitude = $3, elapsed_hours = $4,
          drift_distance_nm = $5, confidence = $6, uncertainty_radius_km = $7, drift_bearing_deg = $8,
          drift_speed_kts = $9, leeway_factor = $10, result = $11::jsonb WHERE id = $1`,
        [driftResultId, drift.originLat, drift.originLon, drift.elapsedHours, drift.driftDistanceNm, drift.confidence,
          drift.uncertaintyRadiusKm, drift.driftVectorBearingDeg, drift.driftSpeedKnots, drift.leewayFactorUsed, JSON.stringify(drift)]
      );
    } else {
      const driftInsert = await client.query(
        `INSERT INTO drift_results
          (incident_id, origin_latitude, origin_longitude, estimated_release_time, elapsed_hours, drift_distance_nm,
           confidence, uncertainty_radius_km, drift_bearing_deg, drift_speed_kts, leeway_factor, result)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb) RETURNING id`,
        [incidentId, drift.originLat, drift.originLon, drift.estimatedReleaseTimeUtc, drift.elapsedHours,
          drift.driftDistanceNm, drift.confidence, drift.uncertaintyRadiusKm, drift.driftVectorBearingDeg,
          drift.driftSpeedKnots, drift.leewayFactorUsed, JSON.stringify(drift)]
      );
      driftResultId = String(driftInsert.rows[0].id);
    }
    const inMemoryVessels: CorrelatedVessel[] = [];
    for (const vessel of demoVessels) {
      const savedVessel = await upsertVessel(client, incidentId, vessel);
      inMemoryVessels.push({
        id: savedVessel.id, name: vessel.name, mmsi: vessel.mmsi, imo: vessel.imo, callsign: vessel.callsign,
        flag: vessel.flag, flagCode: '', vesselType: vessel.vesselType as CorrelatedVessel['vesselType'],
        lengthM: 0, beamM: 0, draftM: vessel.trackCoordinates[1].draftM || 0, draftChangeM: vessel.draftChangeM,
        speedKnots: vessel.trackCoordinates[1].speedKts, courseOverGround: vessel.trackCoordinates[1].courseDeg,
        distanceAtOriginNm: 0, timeDeviationMinutes: 0, attributionScore: 0,
        aisStatus: vessel.aisStatus as CorrelatedVessel['aisStatus'], ownerCompany: '', registeredPort: '',
        destination: '', eta: '', suspectedAction: '',
        trackCoordinates: vessel.trackCoordinates.map((point) => ({ ...point, lat: point.lat, lon: point.lon })),
      });
    }
    const ranked = rankVesselsByAttribution(inMemoryVessels, drift).map((vessel) => applyDataQuality(vessel, demoVessels.find((item) => item.mmsi === vessel.mmsi) || {}));
    ranked.sort((a, b) => b.attributionScore - a.attributionScore);
    await persistRankings(client, incidentId, driftResultId as number | string, ranked);
    await client.query('COMMIT');
    res.status(201).json({
      incidentId,
      incidentCode,
      status: 'seeded',
      drift: { originLat: drift.originLat, originLon: drift.originLon, estimatedReleaseTimeUtc: drift.estimatedReleaseTimeUtc },
      totalCandidates: ranked.length,
      disclaimer: DISCLAIMER,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}));

export { router as apiV1Router };
