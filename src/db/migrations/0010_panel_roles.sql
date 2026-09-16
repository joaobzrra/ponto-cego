CREATE TABLE "role_permissions" (
	"id" serial PRIMARY KEY NOT NULL,
	"role" text NOT NULL,
	"section" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_users" ADD COLUMN "role" text DEFAULT 'admin' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_role_section_ux" ON "role_permissions" USING btree ("role","section");--> statement-breakpoint
-- Default grants (editable in /admin/usuarios). Admin is implicit-full and
-- never stored; patron starts with the advisor read-set (assunto + analytics).
INSERT INTO "role_permissions" ("role", "section") VALUES
	('patron', 'assunto'),
	('patron', 'analytics'),
	('moderator', 'overview'),
	('moderator', 'articles'),
	('moderator', 'clusters'),
	('moderator', 'feedback'),
	('moderator', 'health'),
	('moderator', 'assunto');