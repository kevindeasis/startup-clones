export type Applicant = { name: string; email: string; phone?: string };
export type Attachment = {
  id: string;
  filename: string;
  kind: "site_plan" | "floor_plan" | "elevations" | "other";
  text: string;
  pages?: number;
};
export type Status = "draft" | "submitted" | "in_review" | "reviewed" | "approved" | "needs_info";
export type Check = {
  id: string;
  title: string;
  status: "pass" | "fail" | "needs_info";
  citation: string;
  detail: string;
  source: "rule" | "ai";
};
export type Recommendation = "approve" | "approve_with_conditions" | "request_info" | "deny";
export type Review = {
  checks: Check[];
  summary: string;
  recommendation: Recommendation;
  conditions: string[];
  createdAt: string;
  mock: boolean;
};
export type Application = {
  id: string;
  permitType: string;
  status: Status;
  applicant: Applicant;
  address: string;
  parcel?: string;
  zoning: "R-1" | "R-2" | "C-1";
  projectDescription: string;
  fields: Record<string, string | number | boolean>;
  attachments: Attachment[];
  review?: Review;
  report?: string;
  createdAt: string;
  updatedAt: string;
};

export type Rule = {
  id: string;
  title: string;
  citation: string;
  kind: "max" | "min" | "required_field" | "required_document" | "ratio_max";
  field?: string;
  value?: number;
  numerator?: string;
  denominator?: string;
  document?: string;
};
export type FieldDef = { name: string; label: string; type: "number" | "text" };
export type PermitType = {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  requiredFields: FieldDef[];
  requiredDocuments: string[];
  rules: Rule[];
};
export type CodeSection = { id: string; title: string; chapter: string; text: string };
