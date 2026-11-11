import { describe, expect, it } from "vitest";
import { parseDeployment, withRpcOverride, type Deployment } from "./config";

const base: Deployment = {
  rpcUrl: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  friendbotUrl: "https://friendbot.stellar.org",
  contractId: "CB54OWB4BP5UG6DZXCWKSCSP6UUEHMSDS4IKDASXLEHIMCZHTS7ALYRD",
  nativeSac: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  explorer: "https://stellar.expert/explorer/testnet",
};

describe("config", () => {
  it("parseDeployment requires the public fields", () => {
    expect(() => parseDeployment({})).toThrow(/rpcUrl/);
    expect(parseDeployment(base).contractId).toBe(base.contractId);
  });

  it("withRpcOverride leaves the deployment alone when unset", () => {
    const prev = process.env.VITE_RPC_URL;
    const prev2 = process.env.STANDOFF_RPC_URL;
    delete process.env.VITE_RPC_URL;
    delete process.env.STANDOFF_RPC_URL;
    try {
      expect(withRpcOverride(base)).toEqual(base);
    } finally {
      if (prev !== undefined) process.env.VITE_RPC_URL = prev;
      else delete process.env.VITE_RPC_URL;
      if (prev2 !== undefined) process.env.STANDOFF_RPC_URL = prev2;
      else delete process.env.STANDOFF_RPC_URL;
    }
  });

  it("withRpcOverride applies STANDOFF_RPC_URL for Node/scripts", () => {
    const prev = process.env.VITE_RPC_URL;
    const prev2 = process.env.STANDOFF_RPC_URL;
    delete process.env.VITE_RPC_URL;
    process.env.STANDOFF_RPC_URL = "https://rpc.example.test/soroban";
    try {
      expect(withRpcOverride(base).rpcUrl).toBe("https://rpc.example.test/soroban");
      expect(withRpcOverride(base).contractId).toBe(base.contractId);
    } finally {
      if (prev !== undefined) process.env.VITE_RPC_URL = prev;
      else delete process.env.VITE_RPC_URL;
      if (prev2 !== undefined) process.env.STANDOFF_RPC_URL = prev2;
      else delete process.env.STANDOFF_RPC_URL;
    }
  });
});
