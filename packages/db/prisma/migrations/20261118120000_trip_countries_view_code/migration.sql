-- En rejse kan gå gennem flere lande: "countryCode" bliver til listen "countryCodes".
ALTER TABLE "trip" ADD COLUMN "countryCodes" TEXT[];
UPDATE "trip" SET "countryCodes" = ARRAY["countryCode"::TEXT];
ALTER TABLE "trip" ALTER COLUMN "countryCodes" SET NOT NULL;
ALTER TABLE "trip" DROP COLUMN "countryCode";

-- Deling til visning: en separat kode, der giver rollen "viewer" (kan kun se).
ALTER TABLE "trip" ADD COLUMN "viewCode" CHAR(6);
CREATE UNIQUE INDEX "trip_viewCode_key" ON "trip"("viewCode");
