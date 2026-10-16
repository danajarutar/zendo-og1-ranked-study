// Classification depends only on explicit researcher-maintained identities.
// Never infer test status from a response or demographic value.
export function exportGroups(sessions, smokeParticipants, researcherParticipants = []) {
  const smoke = new Set(smokeParticipants.map(item => item.participant));
  const researcher = new Set(researcherParticipants.map(item => item.participant));
  for (const id of researcher) if (smoke.has(id)) throw new Error("Overlapping test identity manifests.");
  const eligible = sessions.filter(session => !smoke.has(session.participant_code) && !researcher.has(session.participant_code));
  return {
    adult: eligible.filter(session => session.variant === "adult"),
    child: eligible.filter(session => session.variant === "child"),
    researcher: sessions.filter(session => researcher.has(session.participant_code)),
    excluded_smoke_participants: [...smoke],
    excluded_researcher_test_participants: [...researcher],
  };
}
