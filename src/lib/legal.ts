/**
 * Legal documents for Tryanything.
 *
 * Written to match what the code actually does (see docs/ARCHITECTURE.md and docs/SECURITY.md).
 * If you change data handling (e.g. add accounts, recordings, a database), update these texts.
 * Replace every [BRACKETED] placeholder before launch and have the texts reviewed by a lawyer.
 */
export type LegalBlock = string | { list: string[] };
export type LegalSection = { heading: string; blocks: LegalBlock[] };
export type LegalDoc = { slug: "privacy" | "terms" | "aup"; title: string; summary: string; sections: LegalSection[] };

export const LEGAL_UPDATED = "29 October 2026";
export const CONTACT_EMAIL = "[privacy@yourdomain.com]";
const GRIEVANCE = "[Grievance Officer name], reachable at " + CONTACT_EMAIL;

const privacy: LegalDoc = {
  slug: "privacy",
  title: "Privacy Policy",
  summary:
    "Your camera is used only while you are trying clothes on. Tryanything does not record or store your video, does not use cookies, and does not ask for your name or email.",
  sections: [
    {
      heading: "1. Who we are",
      blocks: [
        `Tryanything ("we", "us") is a mobile web app that lets you see clothes on yourself in real time using your device camera. For the purposes of India's Digital Personal Data Protection Act, 2023 ("DPDP Act") we are the Data Fiduciary, and for the EU/UK GDPR we are the controller, of the personal data described below. Contact: ${CONTACT_EMAIL}.`,
      ],
    },
    {
      heading: "2. What we process and why",
      blocks: [
        {
          list: [
            "Live camera video. Only after you switch on consent and allow camera access, your video is streamed directly from your browser to our AI provider, Decart, which returns a video of you wearing the selected garment. Purpose: providing the try-on. Basis: your consent. We do not record, save or view your video, and it never passes through our servers.",
            "Usage events. Anonymous events such as \"session started\", which garment was shown, errors, and which store link you tapped, tagged with a random session ID that is not linked to your identity. Purpose: making the app work better and measuring reliability. Basis: legitimate interests (GDPR) / legitimate use for providing the service you requested (DPDP).",
            "Optional profile answers. The style (womenswear / menswear / both) and age range you tap in the survey. Purpose: understanding our audience and improving recommendations. Basis: your consent, which you give by answering. The survey can be skipped.",
            "Technical data. IP address, browser type and request times, processed by us and our hosting provider to deliver the site, prevent abuse (for example, limiting how often try-on sessions can be started) and keep it secure. Basis: legitimate interests / legitimate use.",
          ],
        },
        "We do not collect your name, email, phone number, location or payment details, and we do not use your data for advertising, profiling, or to train AI models.",
      ],
    },
    {
      heading: "3. Who we share it with",
      blocks: [
        {
          list: [
            "Decart (realtime AI provider): receives your live camera stream and the garment image to generate the try-on video during your session. Its handling of the stream is governed by its own terms and privacy policy at docs.platform.decart.ai.",
            "Vercel (hosting): serves the website and keeps request logs.",
            "Authorities, where the law requires it.",
          ],
        },
        "We do not sell or rent personal data. Store links open third-party websites with their own privacy policies; we do not share your data with them.",
      ],
    },
    {
      heading: "4. How long we keep it",
      blocks: [
        {
          list: [
            "Camera video: not stored by us. Each session is limited to 3 minutes, and ends sooner if you leave the page or switch tabs.",
            "Usage events and technical logs: up to [30] days, then deleted.",
            "Rate-limit counters: held in memory for about one minute.",
          ],
        },
      ],
    },
    {
      heading: "5. Cookies and storage",
      blocks: [
        "Tryanything does not set cookies and does not use your browser's local storage. Fonts and images are served from our own domain.",
      ],
    },
    {
      heading: "6. International transfers",
      blocks: [
        "Our providers may process data outside India and outside your country, including in the United States. Where GDPR applies, transfers rely on appropriate safeguards such as the European Commission's Standard Contractual Clauses. Transfers from India follow the DPDP Act and any restrictions notified under it.",
      ],
    },
    {
      heading: "7. Your rights",
      blocks: [
        "Depending on where you live, you can:",
        {
          list: [
            "withdraw consent at any time: stop a session, close the tab, or block camera access in your browser settings;",
            "ask for access to, correction of, or erasure of personal data we hold about you;",
            "object to or restrict processing, and ask for data portability (GDPR);",
            "nominate another person to exercise your rights in case of death or incapacity (DPDP Act);",
            "complain to a regulator: the Data Protection Board of India, or your local data protection authority in the EU/UK.",
          ],
        },
        `Because we don't ask who you are, we may need the session ID shown in your request, or other details, to find your data. Email ${CONTACT_EMAIL}; we reply within 30 days.`,
      ],
    },
    {
      heading: "8. Grievance Officer",
      blocks: [`Questions or complaints about your data can be sent to our Grievance Officer: ${GRIEVANCE}. We aim to resolve grievances within 30 days.`],
    },
    {
      heading: "9. Age limit",
      blocks: [
        "Tryanything is only for people aged 18 or over. We do not knowingly process data of children. If you believe a child has used the service, contact us and we will delete any related data.",
      ],
    },
    {
      heading: "10. Security",
      blocks: [
        "Video travels over encrypted connections (HTTPS / WebRTC). Our permanent AI-provider key stays on our servers; your browser receives only a short-lived token that expires within a minute and caps the session length. No system is perfectly secure, but we limit what we collect so there is little to expose.",
      ],
    },
    {
      heading: "11. Changes",
      blocks: ["If we change how we handle data, we will update this page and the date at the top. For significant changes we will also let you know in the app."],
    },
  ],
};

const terms: LegalDoc = {
  slug: "terms",
  title: "Terms of Service",
  summary: "Use Tryanything for fun and shopping inspiration. The AI preview is an approximation, not a promise of fit or appearance.",
  sections: [
    {
      heading: "1. Agreement",
      blocks: [
        "By turning on the camera in Tryanything you agree to these Terms, our Privacy Policy and our Acceptable Use Policy. If you do not agree, do not use the service.",
      ],
    },
    { heading: "2. Eligibility", blocks: ["You must be at least 18 years old and able to enter into a binding contract."] },
    {
      heading: "3. The service",
      blocks: [
        "Tryanything shows an AI-generated, real-time preview of you wearing sample garments, and links to third-party stores. The service is free, offered \"as is\", and may change, be limited (for example, session length or how often you can start one) or stop at any time.",
      ],
    },
    {
      heading: "4. AI output",
      blocks: [
        {
          list: [
            "Previews are generated by an AI model and may be inaccurate, including in colour, size, fit, body shape or appearance. Do not rely on them for purchase, sizing, medical or other decisions.",
            "Previews are produced live and are not saved by us. If you capture them yourself (for example with a screenshot), you are responsible for how you use and share them.",
          ],
        },
      ],
    },
    {
      heading: "5. Your conduct",
      blocks: ["You must follow the Acceptable Use Policy. We may end sessions or block access if you break it or if we reasonably suspect abuse."],
    },
    {
      heading: "6. Third-party stores and services",
      blocks: [
        "Store links lead to websites we do not own or control. Purchases are between you and that store. The AI preview is provided by Decart, and your use of it is also subject to Decart's terms and acceptable use policy at docs.platform.decart.ai.",
      ],
    },
    {
      heading: "7. Intellectual property",
      blocks: [
        "The Tryanything name, design and software belong to us or our licensors. Garment images are used under licence. You may not copy, resell or reverse-engineer the service, or access our APIs except through the app.",
      ],
    },
    {
      heading: "8. Disclaimers and liability",
      blocks: [
        "To the extent permitted by law, the service is provided without warranties of any kind, and we are not liable for indirect, incidental or consequential losses, or for any loss arising from purchases you make based on a preview. Nothing in these Terms limits liability that cannot be limited by law, or your statutory rights as a consumer, including under India's Consumer Protection Act, 2019 or the laws of your country.",
      ],
    },
    {
      heading: "9. Governing law",
      blocks: [
        "These Terms are governed by the laws of India. Courts at [City], India have jurisdiction, without affecting any mandatory right you have to bring a claim where you live.",
      ],
    },
    {
      heading: "10. Changes and contact",
      blocks: [`We may update these Terms; the date at the top shows the latest version. Questions: ${CONTACT_EMAIL}.`],
    },
  ],
};

const aup: LegalDoc = {
  slug: "aup",
  title: "Acceptable Use Policy",
  summary: "Try clothes on yourself, respectfully. No nudity, no one else without consent, no minors, no abuse of the system.",
  sections: [
    {
      heading: "1. Only you, with consent",
      blocks: [
        "Use the camera on yourself. Anyone else in the frame must be 18 or over and must have agreed to be included. Never point the camera at someone without their knowledge.",
      ],
    },
    {
      heading: "2. Prohibited content",
      blocks: [
        "You must not use Tryanything to create, attempt to create, capture or share:",
        {
          list: [
            "nudity, sexual or sexually suggestive content, or attempts to remove or reduce clothing;",
            "any content involving a person under 18;",
            "content that impersonates, harasses, bullies, demeans or defames anyone, or misleading \"deepfake\" content of a real person;",
            "hateful, violent or illegal content, or content that infringes someone else's rights.",
          ],
        },
      ],
    },
    {
      heading: "3. Prohibited use of the system",
      blocks: [
        {
          list: [
            "Automating, scripting or scraping the service, or requesting try-on tokens outside the app;",
            "getting around session limits, rate limits, safety filters or any other protection;",
            "reselling the service or access to it, or using it to build a competing product;",
            "interfering with or overloading the service, or probing it for vulnerabilities without our written permission.",
          ],
        },
      ],
    },
    {
      heading: "4. Our AI provider's rules",
      blocks: ["The live preview is generated by Decart, so its acceptable use policy (docs.platform.decart.ai) also applies to your use."],
    },
    {
      heading: "5. Enforcement and reporting",
      blocks: [
        `We may end a session, block access, and where required report illegal content to the authorities. To report misuse, email ${CONTACT_EMAIL}.`,
      ],
    },
  ],
};

export const LEGAL_DOCS: Record<LegalDoc["slug"], LegalDoc> = { privacy, terms, aup };
