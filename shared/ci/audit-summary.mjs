export function formatReviewFindings(findings = [], limit = 5) {
  const reviews = findings.filter((finding) => finding.severity === 'REVIEW' || /^REVIEW-/.test(finding.id ?? ''));
  const lines = reviews.slice(0, limit).map((finding) => {
    const evidence = finding.evidence?.[0];
    const locationText = typeof evidence === 'string'
      ? evidence
      : evidence?.path
        ? `${evidence.path}${evidence.line ? `:${evidence.line}` : ''}`
        : '';
    const location = locationText ? `（${locationText}）` : '';
    return `- ${finding.id ? `${finding.id} ` : ''}${finding.title ?? '未命名建议'}${location}`;
  });
  if (reviews.length > limit) lines.push(`- 另有 ${reviews.length - limit} 条建议，见完整报告`);
  return lines;
}
