import { DriftSimulationResult, DriftWaypoint, MetoceanData } from '../types';

/**
 * Deterministic Lagrangian Hydrodynamic Drift Engine
 * 
 * Computes forward and backward (hindcast) drift trajectories of marine oil slicks
 * by coupling surface ocean currents (100% velocity transfer) with wind leeway
 * (typically 3.0% - 3.5% of 10m wind speed with Coriolis deflection angle).
 */

const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;
const METERS_PER_DEG_LAT = 111132.95; // Earth latitude meter constant

export function runDeterministicDriftModel(
  detectedLat: number,
  detectedLon: number,
  detectedTimeIso: string,
  metocean: MetoceanData,
  elapsedHours: number = 10.4,
  forwardHours: number = 24.0,
  leewayFactor: number = 0.032 // 3.2% wind leeway
): DriftSimulationResult {
  const detectedDate = new Date(detectedTimeIso);
  const timeStepHours = 1.0; // 1 hour discrete integration step

  // 1. Current Velocity Vector in m/s (u = East, v = North)
  // Direction is "towards which" current flows
  const currentRad = metocean.surfaceCurrentDirDeg * DEG_TO_RAD;
  const u_current = metocean.surfaceCurrentSpeedMs * Math.sin(currentRad);
  const v_current = metocean.surfaceCurrentSpeedMs * Math.cos(currentRad);

  // 2. Wind Velocity Vector
  // Wind direction is traditionally "from where" wind blows; drift vector is downwind (dir + 180)
  // Coriolis deflection in Northern Hemisphere deflects surface leeway ~12-15° to the right of downwind
  const coriolisDeflectionDeg = detectedLat >= 0 ? 14 : -14;
  const downwindDirDeg = (metocean.windDirectionDeg + 180 + coriolisDeflectionDeg) % 360;
  const windRad = downwindDirDeg * DEG_TO_RAD;

  // Convert wind speed from knots to m/s (1 kt = 0.514444 m/s)
  const windSpeedMs = metocean.windSpeedKts * 0.514444;
  const leewaySpeedMs = windSpeedMs * leewayFactor;

  const u_wind = leewaySpeedMs * Math.sin(windRad);
  const v_wind = leewaySpeedMs * Math.cos(windRad);

  // 3. Total Combined Surface Drift Vector (m/s)
  const u_total = u_current + u_wind;
  const v_total = v_current + v_wind;
  const driftSpeedMs = Math.sqrt(u_total * u_total + v_total * v_total);
  const driftSpeedKnots = driftSpeedMs * 1.94384;
  const driftBearingDeg = ((Math.atan2(u_total, v_total) * RAD_TO_DEG) + 360) % 360;

  // 4. Backward Drift Hindcast (Rewind in time from T=0 to T = -elapsedHours)
  const backwardWaypoints: DriftWaypoint[] = [];
  let curLat = detectedLat;
  let curLon = detectedLon;

  const totalSteps = Math.ceil(elapsedHours / timeStepHours);
  
  // Detection point at T=0
  backwardWaypoints.push({
    lat: curLat,
    lon: curLon,
    timeUtc: detectedDate.toISOString(),
    stepHours: 0,
    windSpeedKts: metocean.windSpeedKts,
    currentSpeedMs: metocean.surfaceCurrentSpeedMs,
    uncertaintyRadiusKm: 0.8,
  });

  for (let i = 1; i <= totalSteps; i++) {
    const currentElapsed = Math.min(elapsedHours, i * timeStepHours);
    const dtSeconds = (currentElapsed - (i - 1) * timeStepHours) * 3600;

    // Moving backward in time reverses the displacement vector: -u_total, -v_total
    const deltaMetersNorth = -v_total * dtSeconds;
    const deltaMetersEast = -u_total * dtSeconds;

    const deltaLat = deltaMetersNorth / METERS_PER_DEG_LAT;
    const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos(curLat * DEG_TO_RAD);
    const deltaLon = deltaMetersEast / metersPerDegLon;

    curLat += deltaLat;
    curLon += deltaLon;

    const stepDate = new Date(detectedDate.getTime() - currentElapsed * 3600 * 1000);
    // Uncertainty grows linearly as we step backward in time (+0.45 km per hour)
    const uncertaintyRadiusKm = 0.8 + currentElapsed * 0.45;

    backwardWaypoints.push({
      lat: Number(curLat.toFixed(5)),
      lon: Number(curLon.toFixed(5)),
      timeUtc: stepDate.toISOString(),
      stepHours: currentElapsed,
      windSpeedKts: metocean.windSpeedKts,
      currentSpeedMs: metocean.surfaceCurrentSpeedMs,
      uncertaintyRadiusKm: Number(uncertaintyRadiusKm.toFixed(2)),
    });
  }

  const originPoint = backwardWaypoints[backwardWaypoints.length - 1];
  const originLat = originPoint.lat;
  const originLon = originPoint.lon;
  const estimatedReleaseTimeUtc = originPoint.timeUtc;
  const finalUncertaintyKm = originPoint.uncertaintyRadiusKm;

  // 5. Forward Drift Forecast (Forecast coastal spread into future)
  const forwardWaypoints: DriftWaypoint[] = [];
  let fwdLat = detectedLat;
  let fwdLon = detectedLon;
  const fwdSteps = Math.ceil(forwardHours / 4.0); // 4-hour intervals

  for (let j = 1; j <= fwdSteps; j++) {
    const fwdElapsed = j * 4.0;
    const dtSeconds = 4.0 * 3600;

    const deltaMetersNorth = v_total * dtSeconds;
    const deltaMetersEast = u_total * dtSeconds;

    const deltaLat = deltaMetersNorth / METERS_PER_DEG_LAT;
    const metersPerDegLon = METERS_PER_DEG_LAT * Math.cos(fwdLat * DEG_TO_RAD);
    const deltaLon = deltaMetersEast / metersPerDegLon;

    fwdLat += deltaLat;
    fwdLon += deltaLon;

    const stepDate = new Date(detectedDate.getTime() + fwdElapsed * 3600 * 1000);
    forwardWaypoints.push({
      lat: Number(fwdLat.toFixed(5)),
      lon: Number(fwdLon.toFixed(5)),
      timeUtc: stepDate.toISOString(),
      stepHours: fwdElapsed,
      windSpeedKts: metocean.windSpeedKts,
      currentSpeedMs: metocean.surfaceCurrentSpeedMs,
      uncertaintyRadiusKm: Number((1.2 + fwdElapsed * 0.6).toFixed(2)),
    });
  }

  // Calculate total straight-line drift distance in Nautical Miles (1 NM = 1852 meters)
  const dLatMeters = (detectedLat - originLat) * METERS_PER_DEG_LAT;
  const avgLatRad = ((detectedLat + originLat) / 2) * DEG_TO_RAD;
  const dLonMeters = (detectedLon - originLon) * (METERS_PER_DEG_LAT * Math.cos(avgLatRad));
  const totalDriftMeters = Math.sqrt(dLatMeters * dLatMeters + dLonMeters * dLonMeters);
  const driftDistanceNm = Number((totalDriftMeters / 1852).toFixed(2));

  return {
    originLat: Number(originLat.toFixed(4)),
    originLon: Number(originLon.toFixed(4)),
    estimatedReleaseTimeUtc,
    elapsedHours,
    driftDistanceNm,
    confidence: Math.max(75, Math.min(98.5, 96.0 - elapsedHours * 0.4)),
    uncertaintyRadiusKm: finalUncertaintyKm,
    backwardWaypoints,
    forwardWaypoints,
    driftVectorBearingDeg: Math.round(driftBearingDeg),
    driftSpeedKnots: Number(driftSpeedKnots.toFixed(2)),
    leewayFactorUsed: leewayFactor,
  };
}

/**
 * Calculates distance between two coordinates in Nautical Miles (Haversine formula)
 */
export function calculateHaversineDistanceNm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R_nm = 3440.065; // Earth radius in NM
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLon = (lon2 - lon1) * DEG_TO_RAD;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R_nm * c;
}
