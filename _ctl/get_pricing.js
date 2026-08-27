(async () => {
  // Extract the credit/capability matrix from modelConfig. Product metadata only:
  // no project, media, user or session identifiers are touched.
  const entry = performance.getEntriesByType('resource')
    .map(e => e.name)
    .find(n => n.includes('flow.projectInitialData'));
  if (!entry) return { error: 'projectInitialData not found' };

  const j = await (await fetch(entry, { credentials: 'include' })).json();
  const cfg = j?.result?.data?.json?.modelConfig;
  if (!cfg) return { error: 'modelConfig missing' };

  const rows = [];
  const walk = (arr, kind) => (arr || []).forEach(f => {
    Object.values(f.usages || {}).forEach(u => {
      rows.push({
        kind,
        family: f.displayName,
        familyId: f.id,
        key: u.key,
        creditMapping: u.creditMapping ?? null,
        videoLengthSeconds: u.videoLengthSeconds ?? null,
        generationTimeSeconds: u.generationTimeSeconds ?? null,
        supportedResolutions: u.supportedResolutions ?? null,
        supportedAspectRatios: u.supportedAspectRatios ?? null,
        outputsAudio: u.outputsAudio ?? null,
        maxImageInputs: u.maxImageInputs ?? null,
        maxImageReferences: u.maxImageReferences ?? null,
        inputSpec: u.inputSpec ?? null,
        requirements: u.requirements ?? null
      });
    });
  });
  walk(cfg.imageModelFamilies, 'image');
  walk(cfg.videoModelFamilies, 'video');

  return {
    tierDefaults: cfg.tierDefaults ?? null,
    audioModelKey: cfg.audioModelKey ?? null,
    rowCount: rows.length,
    rows
  };
})()
