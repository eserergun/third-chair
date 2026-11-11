import { xdr } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { classifyFailure, codeFromEvents, codeFromText, contractError, diagnosticText, isRace, isStale, resultCode, toChainError } from "./errors";

function diagEvent(topics: xdr.ScVal[], data: xdr.ScVal): xdr.DiagnosticEvent {
  const ev = new xdr.DiagnosticEvent({
    inSuccessfulContractCall: false,
    event: new xdr.ContractEvent({
      ext: xdr.ExtensionPoint.v0(),
      contractId: null,
      type: xdr.ContractEventType.diagnostic,
      body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({ topics, data })),
    }),
  });
  return xdr.DiagnosticEvent.fromXdr(ev.toXdr("base64"), "base64");
}
const storageLimit = () => xdr.ScVal.scvError(xdr.ScError.sceStorage(xdr.ScErrorCode.scecExceededLimit));
const str = (s: string) => xdr.ScVal.scvString(s);

describe("errors", () => {
  it("decodes Error(Contract, #n) from simulation text", () => {
    const text = 'HostError: Error(Contract, #12)\n\nEvent log (newest first):\n   0: [Diagnostic Event] ...';
    expect(codeFromText(text)).toBe(12);
    const e = toChainError(new Error(text));
    expect(e.errorName).toBe("NotReady");
    expect(e.message).toBe("The minute is not ready to settle.");
    expect(isRace(e)).toBe(true);
    expect(isRace(contractError(5))).toBe(false);
  });

  it("turns a wallet's rejection object into words, never [object Object]", () => {
    expect(toChainError({ error: "user-rejected" }).message).toBe("You turned the request down in the wallet.");
    expect(toChainError({ code: -1, message: "internal-error" }).message).toBe("The wallet said: internal-error.");
    expect(toChainError({}).message).toBe("The wallet returned an error.");
  });

  it("fills the room name for Elsewhere", () => {
    expect(contractError(9, { room: 8 }).message).toBe("You already have a chair in Tucsan. Stand up there first.");
  });

  it("decodes a contract error from diagnostic events", () => {
    const err = xdr.ScVal.scvError(xdr.ScError.sceContract(13));
    const ev = new xdr.DiagnosticEvent({
      inSuccessfulContractCall: false,
      event: new xdr.ContractEvent({
        ext: xdr.ExtensionPoint.v0(),
        contractId: null,
        type: xdr.ContractEventType.diagnostic,
        body: xdr.ContractEventBody.v0(new xdr.ContractEventV0({ topics: [xdr.ScVal.scvSymbol("error"), err], data: xdr.ScVal.scvVoid() })),
      }),
    });
    const wire = xdr.DiagnosticEvent.fromXdr(ev.toXdr("base64"), "base64");
    expect(codeFromEvents([wire])).toBe(13);
    expect(codeFromEvents([])).toBeNull();
  });

  it("classifies lost races: footprint, storage limit, resource_limit_exceeded, #3 #4 #12 #18", () => {
    const fp = diagEvent([xdr.ScVal.scvSymbol("error"), storageLimit()], xdr.ScVal.scvVec([str("trying to access contract storage key outside of the footprint"), xdr.ScVal.scvU32(1)]));
    const text = diagnosticText([fp]);
    expect(text).toContain("Error(Storage, ExceededLimit)");
    expect(text).toContain("outside of the footprint");
    const a = classifyFailure({ code: null, result: "invokeHostFunctionTrapped", diag: text }, "abc");
    expect(a).toMatchObject({ errorName: "Footprint", hash: "abc", race: true });
    expect(isStale(a)).toBe(true);

    const lim = diagnosticText([diagEvent([xdr.ScVal.scvSymbol("error"), storageLimit()], str("operation byte-write resources exceeds amount specified"))]);
    expect(classifyFailure({ code: null, result: null, diag: lim }, "h")).toMatchObject({ errorName: "ResourceLimit", race: true });
    expect(classifyFailure({ code: null, result: "invokeHostFunctionResourceLimitExceeded", diag: "" }, "h")).toMatchObject({ errorName: "ResourceLimit", race: true });

    for (const [code, name] of [[3, "Closed"], [4, "Played"], [12, "NotReady"], [18, "NotReveal"]] as const) {
      const e = classifyFailure({ code, result: "invokeHostFunctionTrapped", diag: "" }, "h");
      expect(e).toMatchObject({ errorName: name, race: true, hash: "h" });
      expect(isStale(e)).toBe(false);
      expect(e.message).not.toContain("tx h");
    }
  });

  it("real failures carry the decoded reason and the hash", () => {
    const bad = classifyFailure({ code: 8, result: "invokeHostFunctionTrapped", diag: "" }, "deadbeef");
    expect(bad.race).toBe(false);
    expect(bad.message).toBe("That is not the card you put down. tx deadbeef");
    const odd = classifyFailure({ code: null, result: "invokeHostFunctionInsufficientRefundableFee", diag: "" }, "cafe");
    expect(odd).toMatchObject({ errorName: "TxFailed", race: false, hash: "cafe" });
    expect(odd.message).toBe("The transaction failed (insufficient_refundable_fee). tx cafe");
  });

  it("reads the invokeHostFunction result code from a TransactionResult", () => {
    const op = xdr.OperationResult.opInner(xdr.OperationResultTr.invokeHostFunction(xdr.InvokeHostFunctionResult.invokeHostFunctionResourceLimitExceeded()));
    const res = new xdr.TransactionResult({ feeCharged: 1n, result: xdr.TransactionResultResult.txFailed([op]), ext: xdr.TransactionResultExt.v0() } as never);
    expect(resultCode(xdr.TransactionResult.fromXdr(res.toXdr("base64"), "base64"))).toBe("invokeHostFunctionResourceLimitExceeded");
    expect(resultCode(undefined)).toBeNull();
  });
});
