CREATE EXTENSION IF NOT EXISTS vector;

-- Enums
CREATE TYPE request_type     AS ENUM ('FEATURE','BUG','UI_UX','CONTENT','TECHNICAL');
CREATE TYPE request_priority AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');
CREATE TYPE request_status   AS ENUM ('NEEDS_TRIAGE','NEEDS_ACTION','IN_SPRINT','APPROVED',
                                      'SCOPE_CREEP','COMPLETED','REJECTED','CANCELLED');
CREATE TYPE verdict_status   AS ENUM ('IN_SCOPE','SCOPE_CREEP','REQUIRES_ALIGNMENT','REJECTED');

-- Users, projects
CREATE TABLE app_user (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  global_role TEXT NOT NULL CHECK (global_role IN ('DEVELOPER','CLIENT')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  invite_code TEXT NOT NULL UNIQUE,                  -- pl. 'VT-842-K9X'
  owner_id    UUID NOT NULL REFERENCES app_user(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project_member (
  project_id   UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('OWNER','DEVELOPER','CLIENT')),
  display_name TEXT,                                 -- a "Client: xy" badge forrása
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX ON project_member (user_id);

-- Contract and hour budget
CREATE TABLE contract (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  signed_at  DATE NOT NULL
);
CREATE INDEX ON contract (project_id);

CREATE TABLE contract_passage (
  id          TEXT PRIMARY KEY,                      -- 'cp-0001': ugyanez az id a vektortárakban
  contract_id UUID NOT NULL REFERENCES contract(id) ON DELETE CASCADE,
  category    TEXT NOT NULL CHECK (category IN ('FEATURE','UI_UX','CONTENT','TECHNICAL','SUPPORT')),
  kind        TEXT NOT NULL CHECK (kind IN ('INCLUDED','EXCLUDED')),
  text        TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON contract_passage (contract_id);

CREATE TABLE retainer_budget (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  period          DATE NOT NULL,                     -- a hónap első napja
  total_hours     NUMERIC(5,1) NOT NULL CHECK (total_hours > 0),
  remaining_hours NUMERIC(5,1) NOT NULL,
  version         INTEGER NOT NULL DEFAULT 0,        -- optimista zároláshoz
  UNIQUE (project_id, period),
  CHECK (remaining_hours >= 0 AND remaining_hours <= total_hours)
);

-- Modules and dependencies (the source of the neo4j)
CREATE TABLE module (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('UI','SERVICE','LIBRARY','EXTERNAL')),
  frozen     BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

CREATE TABLE module_dependency (                      -- from_module függ a to_module-tól
  from_module UUID NOT NULL REFERENCES module(id) ON DELETE CASCADE,
  to_module   UUID NOT NULL REFERENCES module(id) ON DELETE CASCADE,
  PRIMARY KEY (from_module, to_module),
  CHECK (from_module <> to_module)
);
CREATE INDEX ON module_dependency (to_module);

-- Requests and decisions
CREATE TABLE change_request (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq             INTEGER GENERATED ALWAYS AS IDENTITY,   -- megjelenítés: #VR-104
  project_id      UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  submitter_id    UUID NOT NULL REFERENCES app_user(id),
  assignee_id     UUID REFERENCES app_user(id),
  title           TEXT NOT NULL,
  type            request_type NOT NULL,
  priority        request_priority NOT NULL,
  deadline        DATE,
  status          request_status NOT NULL DEFAULT 'NEEDS_TRIAGE',
  estimated_hours NUMERIC(5,1) CHECK (estimated_hours >= 0
                    AND estimated_hours * 2 = trunc(estimated_hours * 2)),   -- félórás lépték
  payload_id      TEXT NOT NULL UNIQUE,                   -- a Mongo dokumentum _id-ja
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON change_request (project_id, status);

CREATE TABLE request_module (                          -- a kérés által érintett modulok
  request_id UUID NOT NULL REFERENCES change_request(id) ON DELETE CASCADE,
  module_id  UUID NOT NULL REFERENCES module(id),
  PRIMARY KEY (request_id, module_id)
);
CREATE INDEX ON request_module (module_id);

CREATE TABLE decision (                                -- append-only, az utolsó sor az érvényes
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   UUID NOT NULL REFERENCES change_request(id) ON DELETE CASCADE,
  verdict      verdict_status NOT NULL,
  reason_codes TEXT[] NOT NULL,
  signals      JSONB NOT NULL,                           -- az öt tár nyers jelzései
  decided_by   TEXT NOT NULL,                            -- 'ENGINE' vagy user id
  is_override  BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON decision (request_id, created_at DESC);

CREATE TABLE hours_reservation (                       -- egy kérés legfeljebb egyszer foglalhat
  request_id UUID PRIMARY KEY REFERENCES change_request(id) ON DELETE CASCADE,
  budget_id  UUID NOT NULL REFERENCES retainer_budget(id),
  hours      NUMERIC(5,1) NOT NULL CHECK (hours > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON hours_reservation (budget_id);

-- UI support tables
CREATE TABLE comment (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       UUID NOT NULL REFERENCES change_request(id) ON DELETE CASCADE,
  author_id        UUID NOT NULL REFERENCES app_user(id),
  body             TEXT NOT NULL,
  is_internal_note BOOLEAN NOT NULL DEFAULT false,       -- az ügyfél nem látja
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON comment (request_id, created_at);

CREATE TABLE attachment (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   UUID NOT NULL REFERENCES change_request(id) ON DELETE CASCADE,
  file_name    TEXT NOT NULL,
  mime_type    TEXT,
  size_bytes   BIGINT NOT NULL CHECK (size_bytes >= 0),
  storage_path TEXT NOT NULL,                            -- helyi fájlrendszer
  uploaded_by  UUID NOT NULL REFERENCES app_user(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON attachment (request_id);

CREATE TABLE audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  request_id UUID REFERENCES change_request(id) ON DELETE SET NULL,
  actor_id   UUID REFERENCES app_user(id) ON DELETE SET NULL,
  action     TEXT NOT NULL,                              -- pl. 'FORCE_APPROVE', 'MARK_SCOPE_CREEP'
  details    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (project_id, created_at DESC);

-- Vectors (pgvector)
CREATE TABLE doc_embedding (
  id           TEXT PRIMARY KEY,                         -- 'cp-0001' | 'rq-0001'
  doc_type     TEXT NOT NULL CHECK (doc_type IN ('contract_passage','past_request')),
  project_id   UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  category     TEXT NOT NULL,
  source_id    TEXT NOT NULL,                            -- contract_passage.id / change_request.id
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  embedding    vector(384) NOT NULL
);
CREATE INDEX doc_embedding_hnsw ON doc_embedding
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX ON doc_embedding (project_id);