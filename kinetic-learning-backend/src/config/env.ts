const required = ["DATABASE_URL", "JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const;

export function validateEnvironment() {
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(", ")}`);

  if (process.env.NODE_ENV === "production") {
    for (const key of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET"] as const) {
      if ((process.env[key]?.length ?? 0) < 32) throw new Error(`${key} must be at least 32 characters in production`);
    }
  }
}

export function allowedOrigins() {
  const configured = process.env.CORS_ORIGINS?.split(",").map(v => v.trim()).filter(Boolean) ?? [];
  if (configured.length) return configured;
  return process.env.NODE_ENV === "production" ? [] : ["http://localhost:4200", "http://localhost:3000"];
}
