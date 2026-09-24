# Scene Foundry public production rules

This project evaluates generated static 3D scenes against the submitted brief, actual Engine output, and visible runtime evidence. Passing a build is only one prerequisite: the visible scene must also preserve the input's critical structures and remain readable during camera movement.

The implementation in `src/spec.ts` is the executable rule set. Its rules cover distinct materials and structures, spatial consistency across views, meaningful scene semantics, readable silhouettes and lighting, a usable camera scale, UI hide and restore, visible interaction relationships when present, and the absence of major rendering or runtime defects. It records evidence for each rule and does not let a high aggregate score hide a failed mandatory requirement.

This summary is authored for the public Scene Foundry repository. It is not the original external production document and does not assert certification. Historical local evaluations may have used a different specification snapshot.
