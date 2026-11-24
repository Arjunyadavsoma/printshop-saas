-- Location-aware shop discovery: additive, nullable columns on "Shop".
-- No PostGIS — nearby search does a bounding-box prefilter + Haversine in
-- JS (see src/app/api/shops/nearby/route.ts). Safe to apply to a live
-- database: all new columns are nullable except locationVerified, which
-- has a DEFAULT.
ALTER TABLE "Shop" ADD COLUMN "latitude" DOUBLE PRECISION,
ADD COLUMN "longitude" DOUBLE PRECISION,
ADD COLUMN "fullAddress" TEXT,
ADD COLUMN "city" TEXT,
ADD COLUMN "state" TEXT,
ADD COLUMN "pincode" TEXT,
ADD COLUMN "locationVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "locationUpdatedAt" TIMESTAMP(3);
