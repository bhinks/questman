-- Multi-user support: add role and allowedModuleKeys to users table.
-- role: "admin" | "user". Default "user". The seed script promotes the hub user to admin.
-- allowedModuleKeys: JSON array of module keys the user can access; null = all.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';
ALTER TABLE "users" ADD COLUMN "allowedModuleKeys" TEXT;
