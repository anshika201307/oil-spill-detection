import { PoolClient } from 'pg';
import { pool } from './database';

type Migration = { description: string; sql: string };

const tableMigrations: Migration[] = [
  {
    description: 'create incidents when absent',
    sql: `CREATE TABLE IF NOT EXISTS incidents (
      id BIGSERIAL PRIMARY KEY,
      incident_code VARCHAR(100) NOT NULL UNIQUE,
      name TEXT,
      location_name TEXT,
      detected_at TIMESTAMPTZ NOT NULL,
      latitude NUMERIC(9, 6) NOT NULL,
      longitude NUMERIC(9, 6) NOT NULL,
      area_km2 NUMERIC(14, 4),
      confidence NUMERIC(5, 2),
      estimated_volume_bbl NUMERIC(14, 2),
      spill_type TEXT,
      satellite_source TEXT,
      slick_type TEXT,
      status TEXT,
      metadata JSONB,
      radar_backscatter_db NUMERIC,
      radar_damping_ratio NUMERIC,
      biogenic_probability NUMERIC,
      low_wind_false_alarm_probability NUMERIC,
      image_quality_score NUMERIC,
      snr_ratio_db NUMERIC,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )`,
  },
  {
    description: 'create vessels when absent',
    sql: `CREATE TABLE IF NOT EXISTS vessels (
      id BIGSERIAL PRIMARY KEY,
      mmsi BIGINT NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      vessel_type VARCHAR(100),
      flag VARCHAR(100),
      ais_status VARCHAR(100),
      current_draft_m NUMERIC(8, 2),
      imo TEXT,
      callsign TEXT,
      metadata JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ
    )`,
  },
  {
    description: 'create AIS track points when absent using the legacy key model',
    sql: `CREATE TABLE IF NOT EXISTS ais_track_points (
      id BIGSERIAL PRIMARY KEY,
      vessel_id BIGINT NOT NULL REFERENCES vessels(id),
      incident_id BIGINT REFERENCES incidents(id) ON DELETE CASCADE,
      mmsi BIGINT,
      latitude NUMERIC(9, 6) NOT NULL,
      longitude NUMERIC(9, 6) NOT NULL,
      recorded_at TIMESTAMPTZ NOT NULL,
      observed_at TIMESTAMPTZ,
      speed_kts NUMERIC(7, 2),
      speed_knots NUMERIC(7, 2),
      heading_deg NUMERIC(6, 2),
      course_deg NUMERIC(6, 2),
      draft_m NUMERIC(8, 2),
      data_quality NUMERIC(5, 2),
      ais_status VARCHAR(100),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },
  {
    description: 'create spill detections when absent',
    sql: `CREATE TABLE IF NOT EXISTS spill_detections (
      id BIGSERIAL PRIMARY KEY,
      incident_id BIGINT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
      detected_at TIMESTAMPTZ NOT NULL,
      centroid_latitude NUMERIC(9, 6) NOT NULL,
      centroid_longitude NUMERIC(9, 6) NOT NULL,
      area_km2 NUMERIC(14, 4),
      confidence NUMERIC(5, 2),
      detection_payload JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },
  {
    description: 'create drift results when absent using the legacy timestamp column',
    sql: `CREATE TABLE IF NOT EXISTS drift_results (
      id BIGSERIAL PRIMARY KEY,
      incident_id BIGINT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
      origin_latitude NUMERIC(9, 6) NOT NULL,
      origin_longitude NUMERIC(9, 6) NOT NULL,
      estimated_release_time TIMESTAMPTZ NOT NULL,
      elapsed_hours NUMERIC,
      drift_distance_nm NUMERIC,
      confidence NUMERIC(5, 2),
      uncertainty_radius_km NUMERIC(10, 3),
      drift_bearing_deg NUMERIC(7, 2),
      drift_speed_kts NUMERIC(8, 3),
      leeway_factor NUMERIC,
      result JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  },
  {
    description: 'create vessel correlations when absent using vessel primary keys',
    sql: `CREATE TABLE IF NOT EXISTS vessel_correlations (
      id BIGSERIAL PRIMARY KEY,
      incident_id BIGINT NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
      drift_result_id BIGINT REFERENCES drift_results(id) ON DELETE SET NULL,
      vessel_id BIGINT NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
      spatial_score NUMERIC(5, 2),
      temporal_score NUMERIC(5, 2),
      trajectory_score NUMERIC(5, 2),
      drift_compatibility_score NUMERIC(5, 2),
      ais_confidence_score NUMERIC(5, 2),
      overall_score NUMERIC(5, 2) NOT NULL DEFAULT 0,
      investigative_score NUMERIC(5, 2),
      investigative_rank INTEGER,
      rank INTEGER,
      explanation_bullets JSONB,
      component_breakdown JSONB,
      calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ,
      UNIQUE (incident_id, vessel_id)
    )`,
  },
];

const columnMigrations: Migration[] = [
  { description: 'add incidents.location_name', sql: 'ALTER TABLE incidents ADD COLUMN IF NOT EXISTS location_name TEXT' },
  { description: 'add incidents.satellite_source', sql: 'ALTER TABLE incidents ADD COLUMN IF NOT EXISTS satellite_source TEXT' },
  { description: 'add incidents.slick_type', sql: 'ALTER TABLE incidents ADD COLUMN IF NOT EXISTS slick_type TEXT' },
  { description: 'add incidents.status', sql: 'ALTER TABLE incidents ADD COLUMN IF NOT EXISTS status TEXT' },
  { description: 'add incidents.metadata', sql: 'ALTER TABLE incidents ADD COLUMN IF NOT EXISTS metadata JSONB' },
  { description: 'add incidents.updated_at', sql: 'ALTER TABLE incidents ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ' },
  { description: 'add vessels.imo', sql: 'ALTER TABLE vessels ADD COLUMN IF NOT EXISTS imo TEXT' },
  { description: 'add vessels.callsign', sql: 'ALTER TABLE vessels ADD COLUMN IF NOT EXISTS callsign TEXT' },
  { description: 'add vessels.metadata', sql: 'ALTER TABLE vessels ADD COLUMN IF NOT EXISTS metadata JSONB' },
  { description: 'add vessels.updated_at', sql: 'ALTER TABLE vessels ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ' },
  { description: 'add nullable AIS incident association', sql: 'ALTER TABLE ais_track_points ADD COLUMN IF NOT EXISTS incident_id BIGINT' },
  { description: 'add nullable AIS MMSI alias', sql: 'ALTER TABLE ais_track_points ADD COLUMN IF NOT EXISTS mmsi BIGINT' },
  { description: 'add nullable AIS observed_at alias', sql: 'ALTER TABLE ais_track_points ADD COLUMN IF NOT EXISTS observed_at TIMESTAMPTZ' },
  { description: 'add AIS speed_knots alias', sql: 'ALTER TABLE ais_track_points ADD COLUMN IF NOT EXISTS speed_knots NUMERIC(7, 2)' },
  { description: 'add AIS course_deg alias', sql: 'ALTER TABLE ais_track_points ADD COLUMN IF NOT EXISTS course_deg NUMERIC(6, 2)' },
  { description: 'add AIS data_quality', sql: 'ALTER TABLE ais_track_points ADD COLUMN IF NOT EXISTS data_quality NUMERIC(5, 2)' },
  { description: 'add drift_results.result', sql: 'ALTER TABLE drift_results ADD COLUMN IF NOT EXISTS result JSONB' },
  { description: 'add vessel_correlations.investigative_score', sql: 'ALTER TABLE vessel_correlations ADD COLUMN IF NOT EXISTS investigative_score NUMERIC(5, 2)' },
  { description: 'add vessel_correlations.rank', sql: 'ALTER TABLE vessel_correlations ADD COLUMN IF NOT EXISTS rank INTEGER' },
  { description: 'add vessel_correlations.component_breakdown', sql: 'ALTER TABLE vessel_correlations ADD COLUMN IF NOT EXISTS component_breakdown JSONB' },
  { description: 'add vessel_correlations.updated_at', sql: 'ALTER TABLE vessel_correlations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ' },
];

const indexMigrations: Migration[] = [
  { description: 'index incidents by detection time', sql: 'CREATE INDEX IF NOT EXISTS oiltrace_incidents_detected_at_idx ON incidents (detected_at DESC)' },
  { description: 'index detections by incident and creation time', sql: 'CREATE INDEX IF NOT EXISTS oiltrace_spill_detections_incident_created_idx ON spill_detections (incident_id, created_at DESC)' },
  { description: 'index AIS tracks by incident and observation time', sql: 'CREATE INDEX IF NOT EXISTS oiltrace_ais_incident_observed_idx ON ais_track_points (incident_id, observed_at)' },
  { description: 'index AIS tracks by MMSI and observation time', sql: 'CREATE INDEX IF NOT EXISTS oiltrace_ais_mmsi_observed_idx ON ais_track_points (mmsi, observed_at)' },
  { description: 'index drift results by incident and creation time', sql: 'CREATE INDEX IF NOT EXISTS oiltrace_drift_incident_created_idx ON drift_results (incident_id, created_at DESC)' },
  { description: 'index vessel correlations by incident and rank', sql: 'CREATE INDEX IF NOT EXISTS oiltrace_correlations_incident_rank_idx ON vessel_correlations (incident_id, investigative_rank)' },
];

async function runMigration(client: PoolClient, migration: Migration): Promise<void> {
  try {
    await client.query(migration.sql);
  } catch (error) {
    const detail = error instanceof Error && error.message ? error.message : 'Unknown PostgreSQL error';
    throw new Error(`Schema migration failed (${migration.description}). SQL: ${migration.sql}. PostgreSQL: ${detail}`);
  }
}

async function hasColumn(client: PoolClient, table: string, column: string): Promise<boolean> {
  const result = await client.query(
    'SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2',
    [table, column]
  );
  return Boolean(result.rowCount);
}

async function ensureForeignKey(client: PoolClient, table: string, column: string, targetTable: string, targetColumn: string, constraintName: string): Promise<void> {
  const existing = await client.query(
    `SELECT 1 FROM pg_constraint fk
     JOIN pg_class source_table ON source_table.oid = fk.conrelid
     JOIN pg_namespace source_schema ON source_schema.oid = source_table.relnamespace
     JOIN pg_class target_table ON target_table.oid = fk.confrelid
     JOIN pg_attribute source_column ON source_column.attrelid = source_table.oid AND source_column.attnum = ANY(fk.conkey)
     JOIN pg_attribute target_column ON target_column.attrelid = target_table.oid AND target_column.attnum = ANY(fk.confkey)
     WHERE fk.contype = 'f' AND source_schema.nspname = current_schema()
       AND source_table.relname = $1 AND source_column.attname = $2
       AND target_table.relname = $3 AND target_column.attname = $4`,
    [table, column, targetTable, targetColumn]
  );
  if (existing.rowCount) return;
  const sql = `ALTER TABLE ${table} ADD CONSTRAINT ${constraintName} FOREIGN KEY (${column}) REFERENCES ${targetTable}(${targetColumn}) NOT VALID`;
  await runMigration(client, { description: `ensure ${table}.${column} references ${targetTable}.${targetColumn}`, sql });
}

async function backfillLegacyAisAliases(client: PoolClient): Promise<void> {
  if (await hasColumn(client, 'ais_track_points', 'vessel_id')) {
    await runMigration(client, {
      description: 'backfill AIS MMSI only through its existing vessel_id relation',
      sql: `UPDATE ais_track_points AS point SET mmsi = vessel.mmsi
            FROM vessels AS vessel
            WHERE point.mmsi IS NULL AND point.vessel_id = vessel.id`,
    });
  }

  const timestampColumn = (await hasColumn(client, 'ais_track_points', 'recorded_at'))
    ? 'recorded_at'
    : (await hasColumn(client, 'ais_track_points', 'timestamp')) ? 'timestamp' : null;
  if (timestampColumn) {
    await runMigration(client, {
      description: `backfill AIS observed_at from existing ${timestampColumn}`,
      sql: `UPDATE ais_track_points SET observed_at = ${timestampColumn} WHERE observed_at IS NULL`,
    });
  }

  if (await hasColumn(client, 'ais_track_points', 'speed_kts')) {
    await runMigration(client, {
      description: 'backfill AIS speed_knots from existing speed_kts',
      sql: 'UPDATE ais_track_points SET speed_knots = speed_kts WHERE speed_knots IS NULL',
    });
  }
  if (await hasColumn(client, 'ais_track_points', 'heading_deg')) {
    await runMigration(client, {
      description: 'backfill AIS course_deg from existing heading_deg',
      sql: 'UPDATE ais_track_points SET course_deg = heading_deg WHERE course_deg IS NULL',
    });
  }
}

async function assertColumnType(client: PoolClient, table: string, column: string, expectedType: string): Promise<void> {
  const result = await client.query(
    'SELECT udt_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 AND column_name = $2',
    [table, column]
  );
  const actualType = result.rows[0]?.udt_name;
  if (actualType !== expectedType) {
    throw new Error(`Schema migration cannot safely continue: expected ${table}.${column} to use PostgreSQL type ${expectedType}, found ${actualType || 'missing'}. No column conversion was attempted.`);
  }
}

export async function initializeDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const migration of tableMigrations) await runMigration(client, migration);
    for (const migration of columnMigrations) await runMigration(client, migration);

    await assertColumnType(client, 'incidents', 'id', 'int8');
    await assertColumnType(client, 'vessels', 'id', 'int8');
    await assertColumnType(client, 'vessels', 'mmsi', 'int8');
    await assertColumnType(client, 'spill_detections', 'incident_id', 'int8');
    await assertColumnType(client, 'ais_track_points', 'incident_id', 'int8');
    await assertColumnType(client, 'ais_track_points', 'mmsi', 'int8');
    await assertColumnType(client, 'ais_track_points', 'observed_at', 'timestamptz');
    await assertColumnType(client, 'drift_results', 'incident_id', 'int8');
    await assertColumnType(client, 'vessel_correlations', 'incident_id', 'int8');
    await assertColumnType(client, 'vessel_correlations', 'vessel_id', 'int8');
    await assertColumnType(client, 'vessel_correlations', 'drift_result_id', 'int8');

    await backfillLegacyAisAliases(client);
    await ensureForeignKey(client, 'ais_track_points', 'incident_id', 'incidents', 'id', 'oiltrace_ais_incident_id_fkey');
    await ensureForeignKey(client, 'ais_track_points', 'mmsi', 'vessels', 'mmsi', 'oiltrace_ais_mmsi_fkey');

    for (const migration of indexMigrations) await runMigration(client, migration);
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Keep the original migration failure if PostgreSQL already aborted the transaction.
    }
    throw error;
  } finally {
    client.release();
  }
}
