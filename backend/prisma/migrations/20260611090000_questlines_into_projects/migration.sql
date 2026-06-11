-- Consolidate questlines (quest_chains/chain_steps) into projects.
--
-- A chain becomes a Project with ordered=true; each step becomes a
-- ProjectTask (order → sortOrder, authored xpReward preserved). IDs are
-- REUSED (chain id → project id, step id → task id) so existing quests
-- only need their source flipped: 'chain' → 'project' (sourceId already
-- points at the step/task id).

-- AlterTable: sequenced mode flag on projects
ALTER TABLE "projects" ADD COLUMN "ordered" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: authored fields absorbed from chain_steps
ALTER TABLE "project_tasks" ADD COLUMN "description" TEXT;
ALTER TABLE "project_tasks" ADD COLUMN "xpReward" INTEGER;

-- Data: chains → ordered projects (status 'abandoned' maps to 'archived').
-- moduleId resolves to the owner's 'projects' module — the same module the
-- chain candidate builder already attributed XP to.
INSERT INTO "projects" ("id", "userId", "moduleId", "name", "description", "status", "color", "ordered", "createdAt", "updatedAt")
SELECT
    c."id",
    c."userId",
    (SELECT m."id" FROM "modules" m WHERE m."userId" = c."userId" AND m."key" = 'projects'),
    c."name",
    c."description",
    CASE c."status" WHEN 'abandoned' THEN 'archived' ELSE c."status" END,
    c."color",
    true,
    c."createdAt",
    c."updatedAt"
FROM "quest_chains" c
WHERE EXISTS (SELECT 1 FROM "modules" m WHERE m."userId" = c."userId" AND m."key" = 'projects');

-- Data: steps → tasks (order → sortOrder; 'done' status → done flag).
INSERT INTO "project_tasks" ("id", "userId", "projectId", "title", "description", "done", "estMinutes", "priority", "sortOrder", "xpReward", "completedAt", "createdAt", "updatedAt")
SELECT
    s."id",
    c."userId",
    s."chainId",
    s."title",
    s."description",
    CASE s."status" WHEN 'done' THEN true ELSE false END,
    s."estMinutes",
    0,
    s."order",
    s."xpReward",
    s."completedAt",
    c."createdAt",
    CURRENT_TIMESTAMP
FROM "chain_steps" s
JOIN "quest_chains" c ON c."id" = s."chainId"
WHERE EXISTS (SELECT 1 FROM "projects" p WHERE p."id" = s."chainId");

-- Data: repoint historical + pending quests at the project pool.
UPDATE "quests" SET "source" = 'project' WHERE "source" = 'chain';

-- DropTable
DROP TABLE "chain_steps";
DROP TABLE "quest_chains";
