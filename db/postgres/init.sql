-- Create the vector extension if it doesn't exist.
-- Without this, the Postgres db will not know the vector(384) type.
CREATE EXTENSION IF NOT EXISTS vector;

-- ENUMS
CREATE TYPE request_type     AS ENUM ('FEATURE','BUG','UI_UX','CONTENT','TECHNICAL');
CREATE TYPE request_priority AS ENUM ('LOW','MEDIUM','HIGH','CRITICAL');

-- NEEDS_TRIAGE: new request, not yet reviewed by the team
-- NEEDS_ACTION: the team has reviewed the request, but no decision has been made yet
-- IN_SPRINT: the request has been approved and is in the current sprint
-- APPROVED: the request has been approved and is in the backlog
-- SCOPE_CREEP: the request has been approved, but the team has identified scope creep and needs to renegotiate with the client
-- COMPLETED: the request has been completed and delivered to the client
-- REJECTED: the request has been rejected by the team (needs to be renegotiated with the client)
-- CANCELLED: the request has been cancelled by the client or the team
CREATE TYPE request_status   AS ENUM ('NEEDS_TRIAGE','NEEDS_ACTION','IN_SPRINT','APPROVED',
                                      'SCOPE_CREEP','COMPLETED','REJECTED','CANCELLED');

-- The verdict_status enum is used to represent the outcome of a decision made on a change request. It can have one of the following values:
-- IN_SCOPE: The change request is within the scope of the project and can be implemented as requested.
-- SCOPE_CREEP: The change request is outside the scope of the project and requires renegotiation with the client or stakeholders.
-- REQUIRES_ALIGNMENT: The change request requires alignment with other parts of the project or other stakeholders before it can be implemented.
-- REJECTED: The change request has been rejected and will not be implemented.
CREATE TYPE verdict_status   AS ENUM ('IN_SCOPE','SCOPE_CREEP','REQUIRES_ALIGNMENT','REJECTED');

-- Users, projects
CREATE TABLE app_user (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT NOT NULL UNIQUE,
  full_name   TEXT,
  global_role TEXT NOT NULL CHECK (global_role IN ('DEVELOPER','CLIENT')),
  is_demo     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE project (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  -- for example "AB12-CD34-EF56"
  invite_code TEXT NOT NULL UNIQUE,
  owner_id    UUID NOT NULL REFERENCES app_user(id),
  is_demo     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Who is a member of which project, and what role they have
CREATE TABLE project_member (
  project_id   UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('OWNER','DEVELOPER','CLIENT')),
  -- the badge name to display in the UI, e.g. "Lead Developer" or "Client PM" or "Client: John Doe"
  display_name TEXT,
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
  -- no UUID here, so that we can use the passage id as the document id in the vector store
  id          TEXT PRIMARY KEY,
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
  -- the first day of the month, e.g. 2024-01-01
  period          DATE NOT NULL,
  total_hours     NUMERIC(5,1) NOT NULL CHECK (total_hours > 0),
  remaining_hours NUMERIC(5,1) NOT NULL,
  version         INTEGER NOT NULL DEFAULT 0,
  -- for one project, there is only one budget per month in one month
  UNIQUE (project_id, period),
  CHECK (remaining_hours >= 0 AND remaining_hours <= total_hours)
);

-- Modules and dependencies (the source of the neo4j)
-- the software modules that are part of a project, and their dependencies on each other
CREATE TABLE module (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('UI','SERVICE','LIBRARY','EXTERNAL')),
  -- if true, the module is frozen and cannot be changed or deleted (e.g. a third-party library or before release freeze)
  frozen     BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);

-- which module depends on which other module, for the dependency graph
-- e.g. if module A depends on module B, then there is a row (A,B) in this table
CREATE TABLE module_dependency (
  from_module UUID NOT NULL REFERENCES module(id) ON DELETE CASCADE,
  to_module   UUID NOT NULL REFERENCES module(id) ON DELETE CASCADE,
  PRIMARY KEY (from_module, to_module),
  -- prevents a module from depending on itself
  CHECK (from_module <> to_module)
);
CREATE INDEX ON module_dependency (to_module);

-- Requests and decisions
CREATE TABLE change_request (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- auto-incrementing sequence number for display purposes e.g. "#VR-104"
  seq             INTEGER GENERATED ALWAYS AS IDENTITY,
  project_id      UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  submitter_id    UUID NOT NULL REFERENCES app_user(id),
  assignee_id     UUID REFERENCES app_user(id),
  title           TEXT NOT NULL,
  type            request_type NOT NULL,
  priority        request_priority NOT NULL,
  deadline        DATE,
  status          request_status NOT NULL DEFAULT 'NEEDS_TRIAGE',
  -- half-hour increments only, e.g. 1.0, 1.5, 2.0, 2.5, etc.
  estimated_hours NUMERIC(5,1) CHECK (estimated_hours >= 0
                    AND estimated_hours * 2 = trunc(estimated_hours * 2)),
  -- the id of the mongo document that contains the request's text and attachments
  payload_id      TEXT NOT NULL UNIQUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON change_request (project_id, status);

-- Many-to-many relationship between change requests and modules
-- which modules are affected by which change requests, for the dependency graph
CREATE TABLE request_module (
  request_id UUID NOT NULL REFERENCES change_request(id) ON DELETE CASCADE,
  module_id  UUID NOT NULL REFERENCES module(id),
  PRIMARY KEY (request_id, module_id)
);
CREATE INDEX ON request_module (module_id);

-- append-only: once a decision is made, it cannot be changed or deleted
-- The last row in the table represents the current valid decision for a given change request.
CREATE TABLE decision (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   UUID NOT NULL REFERENCES change_request(id) ON DELETE CASCADE,
  verdict      verdict_status NOT NULL,
  reason_codes TEXT[] NOT NULL,
  -- the signals that led to the decision, e.g. "module A depends on module B, which is out of scope"
  -- the 5 database services (Postgres, MongoDB, Redis, Neo4j, Qdrant) can all be used to generate signals for the decision
  signals      JSONB NOT NULL,
  -- who made the decision: either the ENGINE (the system) or a user (the project team)
  decided_by   TEXT NOT NULL,
  -- if true, the decision was made by a user overriding the system's recommendation
  is_override  BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON decision (request_id, created_at DESC);

-- one request only has one budget reservation, but a budget can have many requests reserved against it
CREATE TABLE hours_reservation (
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
  -- if true, the comment is an internal note that is not visible to the client
  is_internal_note BOOLEAN NOT NULL DEFAULT false,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON comment (request_id, created_at);

CREATE TABLE attachment (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id   UUID NOT NULL REFERENCES change_request(id) ON DELETE CASCADE,
  file_name    TEXT NOT NULL,
  mime_type    TEXT,
  size_bytes   BIGINT NOT NULL CHECK (size_bytes >= 0),
  -- the path where the file is stored in the local file system
  storage_path TEXT NOT NULL,
  uploaded_by  UUID NOT NULL REFERENCES app_user(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON attachment (request_id);

-- Audit log for all actions taken in the system, including user actions and system actions
CREATE TABLE audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  request_id UUID REFERENCES change_request(id) ON DELETE SET NULL,
  actor_id   UUID REFERENCES app_user(id) ON DELETE SET NULL,
  -- the action that was taken, e.g. 'FORCE_APPROVE', 'MARK_SCOPE_CREEP'
  action     TEXT NOT NULL,
  details    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON audit_log (project_id, created_at DESC);

-- Vectors (pgvector)
CREATE TABLE doc_embedding (
  -- the same as the MongoDB document id, so that we can retrieve the document from MongoDB after a vector search
  id           TEXT PRIMARY KEY,
  doc_type     TEXT NOT NULL CHECK (doc_type IN ('contract_passage','past_request')),
  project_id   UUID NOT NULL REFERENCES project(id) ON DELETE CASCADE,
  category     TEXT NOT NULL,
  source_id    TEXT NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  embedding    vector(384) NOT NULL
);
CREATE INDEX doc_embedding_hnsw ON doc_embedding
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX ON doc_embedding (project_id);