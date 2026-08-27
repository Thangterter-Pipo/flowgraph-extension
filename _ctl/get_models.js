(async () => {
  // Re-fetch the project's own initial-data route from page context and extract
  // ONLY model metadata (ids / usage keys / capabilities). No project, media,
  // user or session identifiers are returned.
  const entry = performance.getEntriesByType('resource')
    .map(e => e.name)
    .find(n => n.includes('flow.projectInitialData'));
  if (!entry) return { error: 'projectInitialData resource not found' };

  const r = await fetch(entry, { credentials: 'include' });
  const j = await r.json();
  const cfg = j?.result?.data?.json?.modelConfig;
  if (!cfg) return { error: 'modelConfig missing', status: r.status };

  const fam = (arr) => (arr || []).map(f => ({
    displayName: f.displayName,
    id: f.id,
    enableUpselling: f.enableUpselling,
    usages: Object.fromEntries(
      Object.entries(f.usages || {}).map(([k, v]) => [k, {
        key: v?.modelUsageKey ?? v?.key ?? null,
        credits: v?.credits ?? v?.creditCost ?? null,
        durations: v?.supportedDurations ?? v?.durations ?? null,
        aspects: v?.supportedAspectRatios ?? v?.aspectRatios ?? null,
        maxOutputs: v?.maxOutputCount ?? v?.maxOutputs ?? null,
        fields: Object.keys(v || {})
      }])
    )
  }));

  return {
    status: r.status,
    imageModelFamilies: fam(cfg.imageModelFamilies),
    videoModelFamilies: fam(cfg.videoModelFamilies),
    deprecatedModelKeys: Object.keys(cfg.deprecatedModelKeys || {}),
    modelConfigTopLevelKeys: Object.keys(cfg)
  };
})()
