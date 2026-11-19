export const usd = (n: number | undefined) => (n === undefined ? "n/a" : `$${n.toLocaleString("en-US")}`);

export const FIELD_LABEL: Record<string, string> = {
  businessName: "Legal business name",
  "address.state": "State",
  industry: "Industry",
  "building.squareFeet": "Building sq ft",
  annualRevenue: "Annual revenue",
  annualPayroll: "Annual payroll",
  employees: "Employees",
  vehicles: "Vehicles",
  notes: "Liquor sales share (notes)",
};
