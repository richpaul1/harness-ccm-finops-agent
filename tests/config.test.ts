import { describe, it, expect } from "vitest";
import {
  buildSessionConfig,
  extractAccountIdFromToken,
  loadGlobalConfig,
  SessionAuthError,
  type GlobalConfig,
} from "../src/config.js";

describe("extractAccountIdFromToken", () => {
  it("extracts account ID from a valid PAT", () => {
    expect(extractAccountIdFromToken("pat.acct123.tokenId.secret")).toBe("acct123");
  });

  it("extracts account ID from a PAT with extra dots in secret", () => {
    expect(extractAccountIdFromToken("pat.acct123.tokenId.secret.extra")).toBe("acct123");
  });

  it("returns undefined for non-PAT tokens", () => {
    expect(extractAccountIdFromToken("sat.acct123.tokenId.secret")).toBeUndefined();
  });

  it("returns undefined for tokens with too few segments", () => {
    expect(extractAccountIdFromToken("pat.acct123")).toBeUndefined();
  });

  it("returns undefined for empty account ID segment", () => {
    expect(extractAccountIdFromToken("pat..tokenId.secret")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(extractAccountIdFromToken("")).toBeUndefined();
  });
});

describe("loadGlobalConfig", () => {
  const originalEnv = process.env;

  function withEnv(env: Record<string, string>, fn: () => void) {
    const prev = { ...process.env };
    for (const key of Object.keys(process.env)) {
      delete process.env[key];
    }
    Object.assign(process.env, env);
    try {
      fn();
    } finally {
      for (const key of Object.keys(process.env)) {
        delete process.env[key];
      }
      Object.assign(process.env, prev);
    }
  }

  it("loads with no auth env (auth becomes per-session)", () => {
    withEnv({}, () => {
      const cfg = loadGlobalConfig();
      expect(cfg.HARNESS_API_KEY).toBeUndefined();
      expect(cfg.HARNESS_BEARER_TOKEN).toBeUndefined();
      expect(cfg.HARNESS_COOKIE).toBeUndefined();
      expect(cfg.HARNESS_ACCOUNT_ID).toBeUndefined();
    });
  });

  it("captures auth defaults when present", () => {
    withEnv(
      {
        HARNESS_API_KEY: "pat.acct123.tok.sec",
        HARNESS_ACCOUNT_ID: "acct123",
      },
      () => {
        const cfg = loadGlobalConfig();
        expect(cfg.HARNESS_API_KEY).toBe("pat.acct123.tok.sec");
        expect(cfg.HARNESS_ACCOUNT_ID).toBe("acct123");
      },
    );
  });

  it("applies default HARNESS_BASE_URL", () => {
    withEnv({}, () => {
      expect(loadGlobalConfig().HARNESS_BASE_URL).toBe("https://app.harness.io");
    });
  });

  it("applies default HARNESS_DEFAULT_ORG_ID", () => {
    withEnv({}, () => {
      expect(loadGlobalConfig().HARNESS_DEFAULT_ORG_ID).toBe("default");
    });
  });

  it("applies default LOG_LEVEL", () => {
    withEnv({}, () => {
      expect(loadGlobalConfig().LOG_LEVEL).toBe("info");
    });
  });

  it("applies default timeout and retries", () => {
    withEnv({}, () => {
      const cfg = loadGlobalConfig();
      expect(cfg.HARNESS_API_TIMEOUT_MS).toBe(30000);
      expect(cfg.HARNESS_MAX_RETRIES).toBe(3);
    });
  });

  it("coerces string numbers for timeout and retries", () => {
    withEnv(
      {
        HARNESS_API_TIMEOUT_MS: "10000",
        HARNESS_MAX_RETRIES: "2",
      },
      () => {
        const cfg = loadGlobalConfig();
        expect(cfg.HARNESS_API_TIMEOUT_MS).toBe(10000);
        expect(cfg.HARNESS_MAX_RETRIES).toBe(2);
      },
    );
  });
});

/** Bare-bones GlobalConfig for buildSessionConfig tests — no auth, all defaults applied. */
function emptyGlobal(overrides: Partial<GlobalConfig> = {}): GlobalConfig {
  return {
    HARNESS_API_KEY: undefined,
    HARNESS_BEARER_TOKEN: undefined,
    HARNESS_COOKIE: undefined,
    HARNESS_ACCOUNT_ID: undefined,
    HARNESS_BASE_URL: "https://app.harness.io",
    HARNESS_DEFAULT_ORG_ID: "default",
    HARNESS_DEFAULT_PROJECT_ID: undefined,
    HARNESS_API_TIMEOUT_MS: 30000,
    HARNESS_MAX_RETRIES: 3,
    LOG_LEVEL: "info",
    HARNESS_TOOLSETS: undefined,
    HARNESS_MAX_BODY_SIZE_MB: 10,
    HARNESS_RATE_LIMIT_RPS: 10,
    HARNESS_READ_ONLY: false,
    HARNESS_CCM_CHART_MAX_WIDTH: 2200,
    HARNESS_CCM_CHART_MAX_HEIGHT: 1240,
    HARNESS_CCM_CHART_MAX_POINTS: 120,
    HARNESS_REPORT_PORT: 4321,
    ...overrides,
  };
}

describe("buildSessionConfig — auth resolution", () => {
  it("uses overrides on top of empty global", () => {
    const cfg = buildSessionConfig(emptyGlobal(), {
      HARNESS_BEARER_TOKEN: "session-jwt",
      HARNESS_ACCOUNT_ID: "session-acct",
      HARNESS_BASE_URL: "https://app3.harness.io/gateway",
    });
    expect(cfg.HARNESS_BEARER_TOKEN).toBe("session-jwt");
    expect(cfg.HARNESS_ACCOUNT_ID).toBe("session-acct");
    expect(cfg.HARNESS_BASE_URL).toBe("https://app3.harness.io/gateway");
  });

  it("falls back to env defaults when overrides are missing", () => {
    const cfg = buildSessionConfig(
      emptyGlobal({
        HARNESS_API_KEY: "pat.envacct.tok.sec",
        HARNESS_ACCOUNT_ID: "envacct",
      }),
      {},
    );
    expect(cfg.HARNESS_API_KEY).toBe("pat.envacct.tok.sec");
    expect(cfg.HARNESS_ACCOUNT_ID).toBe("envacct");
  });

  it("override wins over env default", () => {
    const cfg = buildSessionConfig(
      emptyGlobal({
        HARNESS_API_KEY: "pat.envacct.tok.sec",
        HARNESS_ACCOUNT_ID: "envacct",
      }),
      { HARNESS_BEARER_TOKEN: "header-jwt", HARNESS_ACCOUNT_ID: "header-acct" },
    );
    expect(cfg.HARNESS_BEARER_TOKEN).toBe("header-jwt");
    expect(cfg.HARNESS_ACCOUNT_ID).toBe("header-acct");
  });

  it("trims and treats empty-string overrides as not set", () => {
    const cfg = buildSessionConfig(
      emptyGlobal({
        HARNESS_BEARER_TOKEN: "env-jwt",
        HARNESS_ACCOUNT_ID: "envacct",
      }),
      { HARNESS_BEARER_TOKEN: "   ", HARNESS_ACCOUNT_ID: "" },
    );
    expect(cfg.HARNESS_BEARER_TOKEN).toBe("env-jwt");
    expect(cfg.HARNESS_ACCOUNT_ID).toBe("envacct");
  });

  it("extracts account ID from a PAT when none is supplied explicitly", () => {
    const cfg = buildSessionConfig(emptyGlobal(), {
      HARNESS_API_KEY: "pat.extracted123.tok.sec",
    });
    expect(cfg.HARNESS_ACCOUNT_ID).toBe("extracted123");
  });

  it("throws SessionAuthError when no auth is provided anywhere", () => {
    expect(() => buildSessionConfig(emptyGlobal(), {})).toThrowError(SessionAuthError);
    try {
      buildSessionConfig(emptyGlobal(), {});
    } catch (err) {
      expect(err).toBeInstanceOf(SessionAuthError);
      const e = err as SessionAuthError;
      expect(e.missing.some((m) => m.startsWith("auth"))).toBe(true);
      expect(e.missing.some((m) => m.startsWith("account"))).toBe(true);
    }
  });

  it("throws SessionAuthError when only a non-PAT api key is set (no account id)", () => {
    expect(() =>
      buildSessionConfig(emptyGlobal(), {
        HARNESS_API_KEY: "sat.notapat.tok.sec",
      }),
    ).toThrowError(SessionAuthError);
  });

  it("throws SessionAuthError when only a bearer token is set without account id", () => {
    expect(() =>
      buildSessionConfig(emptyGlobal(), { HARNESS_BEARER_TOKEN: "eyJtoken" }),
    ).toThrowError(SessionAuthError);
  });

  it("succeeds with bearer token + explicit account id", () => {
    const cfg = buildSessionConfig(emptyGlobal(), {
      HARNESS_BEARER_TOKEN: "eyJtoken",
      HARNESS_ACCOUNT_ID: "acct123",
    });
    expect(cfg.HARNESS_BEARER_TOKEN).toBe("eyJtoken");
    expect(cfg.HARNESS_ACCOUNT_ID).toBe("acct123");
  });

  it("succeeds with cookie + explicit account id", () => {
    const cfg = buildSessionConfig(emptyGlobal(), {
      HARNESS_COOKIE: "token=abc; other=def",
      HARNESS_ACCOUNT_ID: "acct123",
    });
    expect(cfg.HARNESS_COOKIE).toBe("token=abc; other=def");
    expect(cfg.HARNESS_ACCOUNT_ID).toBe("acct123");
  });

  it("preserves global non-auth fields in the returned Config", () => {
    const cfg = buildSessionConfig(
      emptyGlobal({
        HARNESS_API_TIMEOUT_MS: 5000,
        HARNESS_MAX_RETRIES: 7,
        HARNESS_TOOLSETS: "ccm",
        HARNESS_READ_ONLY: true,
      }),
      {
        HARNESS_BEARER_TOKEN: "eyJtoken",
        HARNESS_ACCOUNT_ID: "acct123",
      },
    );
    expect(cfg.HARNESS_API_TIMEOUT_MS).toBe(5000);
    expect(cfg.HARNESS_MAX_RETRIES).toBe(7);
    expect(cfg.HARNESS_TOOLSETS).toBe("ccm");
    expect(cfg.HARNESS_READ_ONLY).toBe(true);
  });
});
