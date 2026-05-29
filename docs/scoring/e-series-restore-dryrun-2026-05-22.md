# E-series corpus re-score — dry-run impact (2026-05-22)

READ-ONLY. No writes to enrichments.json. Recomputed score_adjusted with current main code (5eff44e) vs persisted values.

## 1. Count + per-record
**72 records** would change score_adjusted.

| Δ | company | role | old → new | cause |
|---|---|---|---|---|
| -8.5 | Hiive | Director, Head of Revenue Operatio | 8.5 → 0 | location (#15) |
| -8.5 | Gradial | GTM Engineer | 8.5 → 0 | location (#15) |
| -8.3 | Cognition | Revenue Operations | 8.3 → 0 | both |
| -7.8 | Sparta | Revenue Operations & Enablement Le | 9 → 1.2 | location (#15) |
| -5.5 | Airwallex | Associate Director, Revenue Strate | 5.5 → 0 | location (#15) |
| -5 | Superhuman | Product Manager, GTM Engineering | 5 → 0 | location (#15) |
| -5 | HebbiaAI | Remotely.jobs | GTM Systems Lead | 5 → 0 | location (#15) |
| -5 | The Trade Desk | Senior Director, GTM Operations | 5 → 0 | location (#15) |
| -4.7 | SecurityScorecard | VP, Revenue Operations & GTM Engin | 10 → 5.3 | location (#15) |
| -4.6 | Airwallex | GTM Partnerships Manager, Canada | 4.6 → 0 | location (#15) |
| -4.5 | Factory | Revenue Operations | 4.5 → 0 | both |
| -4.5 | ClickHouse | Senior Analytics Engineer, GTM | 4.5 → 0 | both |
| -4 | Airwallex | Manager, GTM Partnerships and Grow | 4.6 → 0.6 | location (#15) |
| -3.5 | Airwallex | Senior Manager, Revenue Strategy & | 3.5 → 0 | location (#15) |
| -3.5 | United State | Founding GTM Engineer / GTME (Go-t | 3.5 → 0 | location (#15) |
| -3.5 | Squint | GTM Engineer | 3.5 → 0 | both |
| -3.4 | Sonos | Senior Director of Finance – Globa | 3.4 → 0 | location (#15) |
| -3.4 | Fonoa | Tax Technology Director, GTM | 3.4 → 0 | location (#15) |
| -3.4 | OpenAI | Head of GTM Enablement | 3.4 → 0 | location (#15) |
| -3.2 | University of Miami | Assistant VP, Revenue Cycle System | 3.2 → 0 | location (#15) |
| -3.1 | Airwallex | Manager, Revenue Strategy Operatio | 3.1 → 0 | location (#15) |
| -3.1 | Airwallex | Go-To-Market Partnerships Manager, | 3.1 → 0 | location (#15) |
| -3.1 | Airwallex | GTM Partnerships Manager (Partner  | 3.1 → 0 | location (#15) |
| -2.9 | Airwallex | Manager, Revenue Strategy & Enable | 2.9 → 0 | location (#15) |
| -2.9 | Airwallex | Manager, Revenue Strategy, SG | 2.9 → 0 | location (#15) |
| -2.9 | Airwallex | Senior Manager, Enterprise Strateg | 2.9 → 0 | location (#15) |
| -2.9 | Airwallex | Director, Revenue Strategy & Opera | 2.9 → 0 | location (#15) |
| -2.9 | Amherst College | Loeb Cente | Sales Operations Associate – Amher | 2.9 → 0 | location (#15) |
| -2.7 | PC Tech Magazine | Building a Modern Revenue Operatio | 2.7 → 0 | location (#15) |
| -2.5 | Airwallex | Revenue Operations Manager, ANZ (B | 2.5 → 0 | location (#15) |
| -2.5 | Clickhouse | Director, Revenue Operations - Str | 6.5 → 4 | other |
| -2.4 | Databricks | RVP, GTM Technical & Product Execu | 3.9 → 1.5 | other |
| -2.2 | Stampli | Vice President of Business Operati | 5.7 → 3.5 | other |
| -2 | Remote Jobs USA | Founding Head of GTM | Remote Jobs | 6.3 → 4.3 | location (#15) |
| -1.7 | Sailor Health | Strategy & Operations Director / L | 5 → 3.3 | other |
| -1.6 | Xtalks | GTM Strategy & Operations - NY, He | 4.1 → 2.5 | other |
| +1.6 | Mastercard | Director, Product GTM & Commercial | 3.6 → 5.2 | location (#15) |
| -1.5 | Outreach | Principal GTM Systems Manager | 3.5 → 2 | other |
| -1.5 | Rainbow | Revenue Operations Analyst | 1.5 → 0 | other |
| -1.5 | AppsFlyer | Revenue Operations Manager, North  | 1.5 → 0 | both |
| -1.5 | Portex | GTM Engineer | 1.5 → 0 | both |
| -1.5 | Gympass - undefined | $115,0 | Sales Operations & Productivity Le | 1.5 → 0 | location (#15) |
| -1.3 | Stripe | Underprompt | Product Manager, Growth AI Outreac | 5.9 → 4.6 | location (#15) |
| -1.2 | Polly | GTM Systems Administrator | 4.5 → 3.3 | other |
| -1.2 | ParentSquare, Inc | Senior Revenue Systems Manager | 3.5 → 2.3 | location (#15) |
| -1.1 | Basis ai | Revenue Operations Leader | 6.5 → 5.4 | other |
| +1 | Laurel | Solutions Engineer, GTM | 4.4 → 5.4 | location (#15) |
| -1 | US or Canada ... | Senior Go To Market Systems Engine | 1.8 → 0.8 | location (#15) |
| +1 | Spring Health - New York (Hy | GTM Lead | 0 → 1 | location (#15) |
| -1 | RevPath | Head of Revenue Operations at Akia | 1 → 0 | both |
| -0.9 | Colombia | Revenue Operations Analyst - Colom | 4.5 → 3.6 | location (#15) |
| +0.7 | Zip Co | GTM Strategy and Operations Manage | 0.3 → 1 | location (#15) |
| -0.7 | Zip | GTM Strategy & Operations Senior A | 1.3 → 0.6 | location (#15) |
| -0.6 | Hebbia | Revenue Operations - Hebbia | BeBe | 8.5 → 7.9 | other |
| -0.5 | Airwallex | Associate Director, Revenue Strate | 0.5 → 0 | location (#15) |
| -0.5 | Teleport | GTM Engineer | 0.5 → 0 | other |
| +0.5 | MarTech Do | Mastering the Chief Revenue Office | 3.5 → 4 | location (#15) |
| +0.5 | Jampack AI | Founding Engineer - GTM | 7.8 → 8.3 | location (#15) |
| +0.5 | Unframe AI | GTM Engineer (Remote) | 3.5 → 4 | location (#15) |
| -0.5 | Gympass - undefined | $120,0 | GTM & RevOps Senior Specialist | 0.5 → 0 | location (#15) |
| -0.5 | HackerRank | GTM Engineer - Demand Generation | 0.5 → 0 | location (#15) |
| -0.5 | Profound | GTM Engineer, Post-Sales | 4.8 → 4.3 | other |
| +0.5 | Tapcheck | GTM Engineer | 7.8 → 8.3 | location (#15) |
| +0.5 | FloQast | Revenue Operations Analyst | 0 → 0.5 | location (#15) |
| -0.5 | FloQast | Manager, Revenue Operations (Post- | 1.5 → 1 | location (#15) |
| -0.4 | Applied Systems | Revenue Operations Director, CX | 0.4 → 0 | location (#15) |
| -0.4 | Whatnot | Revenue Operations Manager, Compen | 1.4 → 1 | location (#15) |
| -0.2 | Hex | Head of Revenue Operations | 9 → 8.8 | location (#15) |
| -0.2 | Jai Toor posted on the topic | GTM Engineers Evolve to Applied AI | 4 → 3.8 | other |
| +0.1 | Claylabs | GTM Engineer - Seller Efficiency | 4.8 → 4.9 | location (#15) |
| +0.1 | Justworks | GTM Engineer | 4.8 → 4.9 | location (#15) |
| -0.1 | Gong | Director, GTM Automations & Data | 9.5 → 9.4 | location (#15) |

## 2. Magnitude distribution
- ~±1: 30 · ~±2: 11 · ~±3: 15 · ±4 or more: 16
- direction: 11 up, 61 down
- largest move: -8.5 (8.5 → 0) — Hiive "Director, Head of Revenue Operatio"

## 3. Threshold crossings (minScore=4 default view)
- **21** roles cross the 4-point default-view boundary.
  - would APPEAR (rise to ≥4): 0
  - would DISAPPEAR (drop below 4): 21

| direction | company | role | old → new | cause |
|---|---|---|---|---|
| DISAPPEAR | Hiive | Director, Head of Revenue Operatio | 8.5 → 0 | location (#15) |
| DISAPPEAR | Gradial | GTM Engineer | 8.5 → 0 | location (#15) |
| DISAPPEAR | Cognition | Revenue Operations | 8.3 → 0 | both |
| DISAPPEAR | Sparta | Revenue Operations & Enablement Le | 9 → 1.2 | location (#15) |
| DISAPPEAR | Airwallex | Associate Director, Revenue Strate | 5.5 → 0 | location (#15) |
| DISAPPEAR | Superhuman | Product Manager, GTM Engineering | 5 → 0 | location (#15) |
| DISAPPEAR | HebbiaAI | Remotely.jobs | GTM Systems Lead | 5 → 0 | location (#15) |
| DISAPPEAR | The Trade Desk | Senior Director, GTM Operations | 5 → 0 | location (#15) |
| DISAPPEAR | Airwallex | GTM Partnerships Manager, Canada | 4.6 → 0 | location (#15) |
| DISAPPEAR | Factory | Revenue Operations | 4.5 → 0 | both |
| DISAPPEAR | ClickHouse | Senior Analytics Engineer, GTM | 4.5 → 0 | both |
| DISAPPEAR | Airwallex | Manager, GTM Partnerships and Grow | 4.6 → 0.6 | location (#15) |
| DISAPPEAR | Airwallex | Senior Manager, Revenue Strategy & | 3.5 → 0 | location (#15) |
| DISAPPEAR | United State | Founding GTM Engineer / GTME (Go-t | 3.5 → 0 | location (#15) |
| DISAPPEAR | Squint | GTM Engineer | 3.5 → 0 | both |
| DISAPPEAR | Databricks | RVP, GTM Technical & Product Execu | 3.9 → 1.5 | other |
| DISAPPEAR | Sailor Health | Strategy & Operations Director / L | 5 → 3.3 | other |
| DISAPPEAR | Xtalks | GTM Strategy & Operations - NY, He | 4.1 → 2.5 | other |
| DISAPPEAR | Outreach | Principal GTM Systems Manager | 3.5 → 2 | other |
| DISAPPEAR | Polly | GTM Systems Administrator | 4.5 → 3.3 | other |
| DISAPPEAR | ParentSquare, Inc | Senior Revenue Systems Manager | 3.5 → 2.3 | location (#15) |

## 4. Cause attribution
- location (#15): 52
- both: 7
- other: 13

