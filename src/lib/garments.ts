export type Garment = {
  id: string;
  name: string;
  /** Same-origin path under /public. Clean product shot, white background, ≥512px. */
  image: string;
  /** Fixed "Substitute …" prompt (Decart best practice). No user text reaches the model. */
  prompt: string;
  /** Present for garments the user added (upload / drop / camera / link). Never leaves the device except to Decart. */
  custom?: { blob: Blob };
};

/** Generic prompt for user-supplied garments: the reference image carries the detail, no user text reaches the model. */
export const CUSTOM_GARMENT_PROMPT = "Substitute the current outfit with the garment shown in the reference image";
export const MAX_CUSTOM_GARMENTS = 8;

// Images from DecartAI/tryon-examples (MIT). Replace with your own catalog.
export const GARMENTS: readonly Garment[] = [
  {
    id: "hoodie",
    name: "Navy hoodie",
    image: "/garments/hoodie.jpg",
    prompt: "Substitute the current top with a navy blue hoodie with a white cross logo on the chest and a kangaroo pocket",
  },
  {
    id: "rain-jacket",
    name: "Yellow rain jacket",
    image: "/garments/rain-jacket.jpg",
    prompt: "Substitute the current top with a yellow hooded rain jacket with a grey cross logo on the chest and zip front",
  },
  {
    id: "bomber",
    name: "Black bomber",
    image: "/garments/bomber.jpg",
    prompt: "Substitute the current top with a black bomber jacket with a blue cross logo on the chest and a zip front",
  },
  {
    id: "crewneck",
    name: "Grey crewneck",
    image: "/garments/crewneck.jpg",
    prompt: "Substitute the current top with a grey crewneck sweatshirt with a large blue cross logo on the front",
  },
] as const;

export const STORES: readonly { name: string; url: string }[] = [
  { name: "REVOLVE", url: "https://www.revolve.com" },
  { name: "H&M", url: "https://www.hm.com" },
  { name: "ASOS", url: "https://www.asos.com" },
  { name: "Lululemon", url: "https://www.lululemon.com" },
  { name: "Nordstrom", url: "https://www.nordstrom.com" },
  { name: "Net-a-Porter", url: "https://www.net-a-porter.com" },
  { name: "Mango", url: "https://www.mango.com" },
  { name: "Anthropologie", url: "https://www.anthropologie.com" },
  { name: "Urban Outfitters", url: "https://www.urbanoutfitters.com" },
  { name: "Zara", url: "https://www.zara.com" },
  { name: "Farfetch", url: "https://www.farfetch.com" },
  { name: "Uniqlo", url: "https://www.uniqlo.com" },
  { name: "Gap", url: "https://www.gap.com" },
  { name: "SSENSE", url: "https://www.ssense.com" },
  { name: "Myntra", url: "https://www.myntra.com" },
  { name: "Ajio", url: "https://www.ajio.com" },
];
