// Mirrors the report the server returns (server/src/checks/report.ts). Keep the two in sync.

export type Verdict = 'supported' | 'contradicted' | 'misleading' | 'unverifiable';
export type OriginGrade = 'full' | 'partial' | 'final_only' | 'contradicted' | 'none';

export interface MaterialComponent {
  name: string;
  percent: number | null;
  key: string | null;
  label: string;
  kind: string;
  plain: string;
  animal: boolean;
  plastic: boolean;
  natural: boolean;
}

export interface Report {
  product: { brand: string | null; name: string | null; category: string; gtin: string | null };
  sampleMode: boolean;
  materials: { part: string; components: MaterialComponent[]; from: 'label' | 'listing' }[];
  materialSummary: { plasticShare: number | null; naturalShare: number | null; hasAnimal: boolean; hasPlasticLeather: boolean; text?: string | null } | null;
  jewelryMarks: string[];
  claims: { quote: string; kind: string; verdict: Verdict; reason: string; from: 'label' | 'listing'; basis: string | null }[];
  wording: { title: string; quote: string; meaning: string; verdict: 'misleading' | 'info'; basis: string; from: 'label' | 'listing' }[];
  origin: {
    text: string | null;
    wording: string;
    explanation: string;
    grade: OriginGrade;
    gradeLabel: string;
    gradeExplanation: string;
    ladder: { stage: string; label: string; country: string | null; basis: string | null }[];
    design: string | null;
  };
  contradictions: { title: string; detail: string }[];
  certifications: { name: string; id: string | null; status: string }[];
  care: string[];
  sources: { type: 'label' | 'listing'; url: string | null; readAt: string; mode: string }[];
  notes: string[];
  counts: Record<Verdict, number>;
}
