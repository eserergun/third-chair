// Contract errors (SPEC 5.6), stable codes and client messages.

export const ERRORS = {
  NoRoom: [1, "That room is not on the survey."],
  NotSeated: [2, "You are not in this minute."],
  Closed: [3, "The minute is closed."],
  Played: [4, "Your card is already down."],
  BadCard: [5, "The card is not on the table."],
  BadTarget: [6, "Iron needs another chair."],
  NoBullet: [7, "The belt is empty."],
  BadReveal: [8, "That is not the card you put down."],
  Elsewhere: [9, "You already have a chair in {Name}. Stand up there first."],
  OwnerBusy: [10, "Your wallet already has a chair, maybe in another browser. Stand up there, or link the wallet here again."],
  Full: [11, "The table is full."],
  NotReady: [12, "The minute is not ready to settle."],
  Choosing: [13, "Another chair is still choosing. Your card goes face down."],
  NoOffer: [14, "That chair has not offered itself to you."],
  BadName: [16, "Names are letters, numbers, and spaces. Twelve at most. The house names are taken."],
  BadAmount: [17, "That amount does not work."],
  NotReveal: [18, "The cards are not turning over yet."],
  BadOwner: [19, "A chair cannot claim itself."],
} as const;

export type ErrorName = keyof typeof ERRORS;

export function errorMessage(name: ErrorName, roomName?: string): string {
  const msg: string = ERRORS[name][1];
  return msg.replace("{Name}", roomName ?? "another room");
}

export function errorByCode(code: number): ErrorName | undefined {
  return (Object.keys(ERRORS) as ErrorName[]).find((k) => ERRORS[k][0] === code);
}

/** Errors from a lost croupier race: never toast these. */
export const QUIET_ERRORS: readonly ErrorName[] = ["NotReady", "Closed", "Played", "NotReveal"];

export class GameError extends Error {
  readonly code: number;
  readonly errorName: ErrorName;
  constructor(name: ErrorName, roomName?: string) {
    super(errorMessage(name, roomName));
    this.name = "GameError";
    this.errorName = name;
    this.code = ERRORS[name][0];
  }
}

export function isGameError(e: unknown, name?: ErrorName): e is GameError {
  return e instanceof GameError && (name === undefined || e.errorName === name);
}
