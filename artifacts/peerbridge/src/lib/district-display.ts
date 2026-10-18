export function countyLabel(county: string): string {
  const name = county.trim();
  return /\bcounty$/i.test(name) ? name : `${name} County`;
}

export function districtTypeLabel(type: string): string {
  switch (type) {
    case "high_school":
      return "High school";
    case "unified":
      return "Unified";
    case "elementary":
      return "TK–8";
    default:
      return "School district";
  }
}
