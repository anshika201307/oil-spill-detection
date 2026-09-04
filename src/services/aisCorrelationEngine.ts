import { CorrelatedVessel, AisScoreBreakdown, DriftSimulationResult } from '../types';
import { calculateHaversineDistanceNm } from './driftModel';

export interface CorrelationWeights {
  spatial: number;     // e.g. 0.30
  temporal: number;    // e.g. 0.25
  trajectory: number;  // e.g. 0.20
  drift: number;       // e.g. 0.15
  confidence: number;  // e.g. 0.10
}

export const DEFAULT_CORRELATION_WEIGHTS: CorrelationWeights = {
  spatial: 0.30,
  temporal: 0.25,
  trajectory: 0.20,
  drift: 0.15,
  confidence: 0.10,
};

/**
 * AIS Correlation & Vessel Attribution Engine
 * Computes multi-factor spatial-temporal kinematic correlation between
 * candidate vessel trajectories and the backward drift hindcast origin.
 */
export function correlateVesselToDrift(
  vessel: CorrelatedVessel,
  driftResult: DriftSimulationResult,
  weights: CorrelationWeights = DEFAULT_CORRELATION_WEIGHTS
): AisScoreBreakdown {
  const originLat = driftResult.originLat;
  const originLon = driftResult.originLon;
  const originTime = new Date(driftResult.estimatedReleaseTimeUtc).getTime();

  // 1. Spatial Correlation: Find closest point of approach (CPA) on vessel trajectory to origin
  let minDistanceNm = 999.0;
  let closestWaypoint = vessel.trackCoordinates[0];
  let timeAtCpa = originTime;

  for (const wp of vessel.trackCoordinates) {
    const dist = calculateHaversineDistanceNm(originLat, originLon, wp.lat, wp.lon);
    if (dist < minDistanceNm) {
      minDistanceNm = dist;
      closestWaypoint = wp;
      timeAtCpa = new Date(wp.timeUtc).getTime();
    }
  }

  // Spatial Score: High if vessel passed within uncertainty corridor (e.g. < 2.0 NM)
  // Exponential / linear decay beyond 0.5 NM
  let spatialScore = 0;
  if (minDistanceNm <= 0.5) {
    spatialScore = 100 - (minDistanceNm / 0.5) * 6; // 94 - 100%
  } else if (minDistanceNm <= 3.0) {
    spatialScore = Math.max(20, 94 - ((minDistanceNm - 0.5) / 2.5) * 55); // 39 - 94%
  } else if (minDistanceNm <= 8.0) {
    spatialScore = Math.max(5, 39 - ((minDistanceNm - 3.0) / 5.0) * 30);
  } else {
    spatialScore = Math.max(0, 8 - (minDistanceNm - 8.0) * 0.5);
  }

  // 2. Temporal Correlation: Time discrepancy between vessel CPA and estimated spill release window
  const timeDeltaMinutes = Math.abs(timeAtCpa - originTime) / (60 * 1000);
  let temporalScore = 0;
  if (timeDeltaMinutes <= 15) {
    temporalScore = 100 - (timeDeltaMinutes / 15) * 8; // 92 - 100%
  } else if (timeDeltaMinutes <= 60) {
    temporalScore = Math.max(30, 92 - ((timeDeltaMinutes - 15) / 45) * 50); // 42 - 92%
  } else if (timeDeltaMinutes <= 180) {
    temporalScore = Math.max(10, 42 - ((timeDeltaMinutes - 60) / 120) * 30);
  } else {
    temporalScore = Math.max(0, 10 - (timeDeltaMinutes - 180) * 0.05);
  }

  // 3. Trajectory Score: Does the track intersect the reconstructed backward drift path corridor?
  let minDistanceToAnyDriftWaypoint = 999.0;
  for (const driftWp of driftResult.backwardWaypoints) {
    for (const vWp of vessel.trackCoordinates) {
      const d = calculateHaversineDistanceNm(driftWp.lat, driftWp.lon, vWp.lat, vWp.lon);
      if (d < minDistanceToAnyDriftWaypoint) {
        minDistanceToAnyDriftWaypoint = d;
      }
    }
  }

  let trajectoryScore = 0;
  if (minDistanceToAnyDriftWaypoint <= 1.0) {
    trajectoryScore = 100 - minDistanceToAnyDriftWaypoint * 10;
  } else if (minDistanceToAnyDriftWaypoint <= 5.0) {
    trajectoryScore = Math.max(25, 90 - ((minDistanceToAnyDriftWaypoint - 1.0) / 4.0) * 60);
  } else {
    trajectoryScore = Math.max(0, 25 - minDistanceToAnyDriftWaypoint * 1.5);
  }

  // 4. Drift Compatibility Score: Kinematic match, speed variation, and draft change
  // Tankers reducing speed to < 10 kts or having draft reduction anomaly receive higher compatibility
  let driftCompatibilityScore = 70;
  if (vessel.vesselType === 'Crude Oil Tanker' || vessel.vesselType === 'Product Tanker' || vessel.vesselType === 'Chemical Tanker') {
    driftCompatibilityScore += 10;
  }
  if (vessel.draftChangeM < -0.3) {
    // Draft reduction indicates liquid discharge
    driftCompatibilityScore += 18;
  }
  if (closestWaypoint.speedKts <= 10.5 && closestWaypoint.speedKts >= 4.0) {
    driftCompatibilityScore += 6; // Tanker wash / bilge discharge speed regime
  }
  if (vessel.aisStatus === 'ANOMALOUS_BLACKOUT' || vessel.aisStatus === 'SPOOFING_DETECTED') {
    driftCompatibilityScore += 8;
  }
  driftCompatibilityScore = Math.min(100, Math.max(0, driftCompatibilityScore));

  // 5. AIS Data Confidence: Transponder reliability & data integrity
  let aisConfidenceScore = 95;
  if (vessel.aisStatus === 'ANOMALOUS_BLACKOUT') {
    aisConfidenceScore = 78; // Transponder gap recorded
  } else if (vessel.aisStatus === 'SPOOFING_DETECTED') {
    aisConfidenceScore = 65;
  } else if (vessel.trackCoordinates.length < 3) {
    aisConfidenceScore = 70;
  }

  // 6. Overall Weighted Correlation Score
  const totalWeight = weights.spatial + weights.temporal + weights.trajectory + weights.drift + weights.confidence;
  const overallScore = Number(
    (
      (spatialScore * weights.spatial +
        temporalScore * weights.temporal +
        trajectoryScore * weights.trajectory +
        driftCompatibilityScore * weights.drift +
        aisConfidenceScore * weights.confidence) /
      totalWeight
    ).toFixed(1)
  );

  // 7. Generate Explainability Bullets dynamically from data
  const bullets: string[] = [];

  if (minDistanceNm <= 1.0) {
    bullets.push(`Near estimated spill origin (${minDistanceNm.toFixed(2)} NM closest point of approach).`);
  } else if (minDistanceNm <= 4.0) {
    bullets.push(`Track within outer search envelope (${minDistanceNm.toFixed(2)} NM from origin).`);
  } else {
    bullets.push(`Divergent position from origin (${minDistanceNm.toFixed(2)} NM offset).`);
  }

  if (timeDeltaMinutes <= 20) {
    bullets.push(`Present during estimated spill time window (Δt = ${Math.round(timeDeltaMinutes)} min).`);
  } else if (timeDeltaMinutes <= 60) {
    bullets.push(`Passed origin within ±${Math.round(timeDeltaMinutes)} minutes of calculated release timestamp.`);
  } else {
    bullets.push(`Time offset exceeds ${Math.round(timeDeltaMinutes / 60)} hours from hindcast origin time.`);
  }

  if (trajectoryScore >= 75) {
    bullets.push(`Historical AIS trajectory intersects reconstructed backward drift corridor.`);
  }

  if (vessel.draftChangeM < -0.3) {
    bullets.push(`Recorded draft reduction of ${Math.abs(vessel.draftChangeM).toFixed(2)}m consistent with liquid tank discharge.`);
  }

  if (vessel.aisStatus === 'ANOMALOUS_BLACKOUT') {
    bullets.push(`AIS transponder gap / blackout detected during passage through sector.`);
  } else if (vessel.aisStatus === 'SPEED_DISCREPANCY') {
    bullets.push(`Anomalous deceleration to ${closestWaypoint.speedKts} kts near origin coordinate.`);
  }

  if (vessel.vesselType.includes('Tanker')) {
    bullets.push(`Vessel classification (${vessel.vesselType}) matches detected petroleum cargo profile.`);
  }

  return {
    spatialScore: Math.round(spatialScore),
    temporalScore: Math.round(temporalScore),
    trajectoryScore: Math.round(trajectoryScore),
    driftCompatibilityScore: Math.round(driftCompatibilityScore),
    aisConfidenceScore: Math.round(aisConfidenceScore),
    overallScore,
    weightsUsed: weights,
    explanationBullets: bullets,
    investigativeRank: 1, // Will be set during multi-vessel sorting
  };
}

/**
 * Re-correlates and ranks an entire fleet of candidate vessels against a drift result
 */
export function rankVesselsByAttribution(
  vessels: CorrelatedVessel[],
  driftResult: DriftSimulationResult,
  weights: CorrelationWeights = DEFAULT_CORRELATION_WEIGHTS
): CorrelatedVessel[] {
  const scored = vessels.map((vessel) => {
    const breakdown = correlateVesselToDrift(vessel, driftResult, weights);
    return {
      ...vessel,
      attributionScore: breakdown.overallScore,
      distanceAtOriginNm: Number(
        calculateHaversineDistanceNm(
          driftResult.originLat,
          driftResult.originLon,
          vessel.trackCoordinates[1]?.lat || vessel.trackCoordinates[0].lat,
          vessel.trackCoordinates[1]?.lon || vessel.trackCoordinates[0].lon
        ).toFixed(2)
      ),
      scoreBreakdown: breakdown,
    };
  });

  // Sort descending by attribution score
  scored.sort((a, b) => b.attributionScore - a.attributionScore);

  // Assign ranks
  scored.forEach((v, index) => {
    if (v.scoreBreakdown) {
      v.scoreBreakdown.investigativeRank = index + 1;
    }
  });

  return scored;
}
