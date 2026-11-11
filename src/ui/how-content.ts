// Copy for the "How it works" page. Plain data, so the page component only lays it out.
// Keep it in line with SPEC.md sections 2 and 4 and with the live contract config.

export interface HowExample {
  cards: [string, string, string]; // e.g. "Air", "Iron at Ivy", "Table"
  result: string;
}

export interface HowSection {
  id: string;
  title: string;
  body?: string[]; // paragraphs
  bullets?: string[];
  examples?: HowExample[];
}

export const HOW_TITLE = "How it works";
export const HOW_LEAD =
  "Three chairs. One minute. Each chair puts one card face down, and the cards turn over together. If exactly one chair is left standing, that chair takes the purse: 1 testnet XLM, paid by the contract to the winner's wallet. Sitting is free.";

export const HOW_SECTIONS: HowSection[] = [
  {
    id: "stakes",
    title: "What you play for",
    body: [
      "There is no entry fee. You never put XLM on the table. The purse is the house's money: the contract holds a treasury of testnet XLM and pays 1 XLM to the sole survivor of a minute.",
      "Your only cost is the network fee of each card, a tiny amount paid by your session key, which Friendbot fills with free testnet XLM.",
    ],
    bullets: [
      "Win a minute: 1 testnet XLM goes straight to your linked wallet, in the same transaction that settles the minute.",
      "Guests (no wallet linked) can win the chair but are not paid. Link a wallet with one signature to collect.",
      "The purse pays at most 60 wins per hour across all rooms, and 25 wins per wallet per day. Over that, the win is recorded and the purse rests.",
      "If anybody ran (sealed a card and never showed it), nobody is paid that minute.",
    ],
  },
  {
    id: "cards",
    title: "The three cards",
    body: ["Pick one card each minute. Keys 1, 2 and 3 work too."],
    bullets: [
      "Air: you stand in the open with no bullet. You win if you are the only one standing and nobody shot you.",
      "Iron: you fire your one bullet at another chair. You win if that chair played Air, you were not hit, and nobody else is standing.",
      "Table: you duck. You cannot be hit, and you cannot win.",
    ],
  },
  {
    id: "who-wins",
    title: "Who takes the purse",
    body: [
      "A chair is standing if it played Air or Iron and was not hit. A bullet hits any chair that did not play Table. The purse pays only when exactly one chair is standing, and an Iron winner must have hit a chair that played Air.",
    ],
    examples: [
      { cards: ["Air", "Table", "Table"], result: "Seat 1 is the only one standing: it takes the purse." },
      { cards: ["Iron at seat 2", "Air", "Table"], result: "Seat 1 shoots seat 2, who stood in the open. Seat 1 is the only one standing: it takes the purse." },
      { cards: ["Air", "Air", "Table"], result: "Two chairs are standing. Nobody is paid." },
      { cards: ["Iron at seat 2", "Iron at seat 1", "Table"], result: "They shoot each other. Nobody is standing. Nobody is paid." },
      { cards: ["Iron at seat 2", "Table", "Table"], result: "The bullet hits the table. One chair is standing, but the iron did not find open air. Nobody is paid." },
    ],
  },
  {
    id: "house",
    title: "The house: Cal, Ivy and Ned",
    body: [
      "Empty chairs are played by the house, so you can always play, even alone. Each minute a house chair plays Air 2 times in 7, Table 2 times in 7, and Iron 3 times in 7 at a random other chair (house chairs can shoot each other).",
      "House cards are drawn by the Stellar network's random number generator only after every card is fixed, and the seed is used one ledger later. Nobody, not even the player who settles the minute, can see the house cards in time to change anything.",
    ],
  },
  {
    id: "minute",
    title: "How a minute runs",
    body: [
      "Every step is a Stellar testnet transaction. Your browser signs them with your session key, so no wallet popup opens during play.",
    ],
    bullets: [
      "Open (up to 60 s): cards go down. Alone at the table, your card goes face up and the minute locks at once.",
      "With other players, cards are sealed: only a hash goes on chain, so nobody can see your card. When everyone has sealed, the cards turn over (up to 45 s). Your browser reveals yours by itself.",
      "Locked: every card is fixed. One ledger later (about 5 s), the minute settles: the house cards are drawn, the winner is found, and the purse pays.",
      "Then the next minute opens at once with fresh, standing cowboys.",
    ],
  },
  {
    id: "rules",
    title: "Bullets, sleepers and runners",
    bullets: [
      "You get one bullet per sitting. Once you fire, the belt is empty until you stand up and sit again. The house reloads every minute.",
      "No card in time plays Air. Two missed minutes in a row and you are carried out (one, if somebody is waiting for your chair).",
      "Sealing a card and never showing it means you ran: you cannot win, you can be shot, you lose the chair, and nobody is paid that minute.",
      "Three quiet minutes in a row (no Iron from anyone) scatter the table.",
      "A newcomer waits in the queue and sits when the current minute settles. One wallet holds one chair at a time.",
    ],
  },
  {
    id: "doors",
    title: "Walking in",
    bullets: [
      "Guest: the site makes a session key in your browser and Friendbot funds it. You play at once. Wins are not paid.",
      "Stellar wallet: Varial (formerly Freighter), xBull, Albedo, Lobstr, Hana, Rabet and more. One signature links your session key to the wallet. Your wins pay that wallet.",
      "Testnet secret key: paste an S... key to act as your wallet. Testnet only.",
    ],
  },
  {
    id: "chain",
    title: "On chain, in the open",
    body: [
      "There is no game server. The rules, every card, every result and every payout live in one Soroban smart contract on Stellar testnet, and this site is static. Each toast links to its transaction on stellar.expert, and the contract link is at the bottom of every page.",
    ],
  },
  {
    id: "agents",
    title: "Agents",
    body: [
      "AI agents play the same contract with the Stellar CLI. skill.md is the whole interface. An agent can offer itself to a human; the human accepts on the claim page with one signature, and the agent's wins then pay that human.",
    ],
  },
  {
    id: "faq",
    title: "Questions",
    bullets: [
      "Why was my card Air? It did not land before the minute closed. Missing the minute plays Air.",
      "Why was I not paid? You were a guest or an unclaimed agent, you slept through the minute, somebody ran, or the purse was resting. The result line says which.",
      "Is this real money? No. It is Stellar testnet XLM, free from Friendbot. Do not use these keys for real funds.",
      "Why does a minute take a while? Every card is a transaction, and a settled minute needs two ledgers so the house cards stay fair.",
    ],
  },
];
