function cloneSubmission(submission) {
  return {
    ...submission,
    assetsReceivedText: [...submission.assetsReceivedText],
    assetsSentText: [...submission.assetsSentText],
    warnings: [...submission.warnings],
    uncertaintyNotes: [...submission.uncertaintyNotes],
    reviewDecision: null,
  };
}

function normalizeIndexes(indexes) {
  if (!Array.isArray(indexes) || indexes.length < 2) {
    throw new Error("combineAssets.indexes must contain at least two indexes.");
  }

  const normalized = [...new Set(indexes.map((value) => Number(value)))].sort(
    (a, b) => a - b,
  );

  if (normalized.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new Error("combineAssets.indexes must be non-negative integers.");
  }

  return normalized;
}

function combineAssetLines(lines, instruction, submissionId) {
  const indexes = normalizeIndexes(instruction.indexes);
  const replacement = String(instruction.displayText ?? "").trim();

  if (!replacement) {
    throw new Error(
      `${submissionId}: combineAssets.displayText must be non-empty.`,
    );
  }

  if (indexes[indexes.length - 1] >= lines.length) {
    throw new Error(
      `${submissionId}: combineAssets index exceeds available asset lines.`,
    );
  }

  const firstIndex = indexes[0];
  const indexesSet = new Set(indexes);
  const output = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (index === firstIndex) {
      output.push(replacement);
    }

    if (!indexesSet.has(index)) {
      output.push(lines[index]);
    }
  }

  return output;
}

export function applyNbaIntakeDecisions(submissions, decisionDocument) {
  if (!Array.isArray(submissions)) {
    throw new TypeError("submissions must be an array.");
  }

  if (!decisionDocument) {
    return submissions.map(cloneSubmission);
  }

  if (!Array.isArray(decisionDocument.decisions)) {
    throw new TypeError("decisionDocument.decisions must be an array.");
  }

  const bySubmissionId = new Map(
    decisionDocument.decisions.map((decision) => [
      decision.submissionId,
      decision,
    ]),
  );

  return submissions.map((submission) => {
    const output = cloneSubmission(submission);
    const decision = bySubmissionId.get(submission.submissionId);

    if (!decision) return output;

    for (const instruction of decision.combineAssets ?? []) {
      if (instruction.direction === "received") {
        output.assetsReceivedText = combineAssetLines(
          output.assetsReceivedText,
          instruction,
          submission.submissionId,
        );
      } else if (instruction.direction === "sent") {
        output.assetsSentText = combineAssetLines(
          output.assetsSentText,
          instruction,
          submission.submissionId,
        );
      } else {
        throw new Error(
          `${submission.submissionId}: unsupported combineAssets direction '${instruction.direction}'.`,
        );
      }
    }

    output.reviewDecision = {
      status: decision.status,
      summary: decision.summary,
      acceptedWarningCodes: [...(decision.acceptedWarningCodes ?? [])],
      canonicalImportReady: decision.canonicalImportReady === true,
    };

    return output;
  });
}
