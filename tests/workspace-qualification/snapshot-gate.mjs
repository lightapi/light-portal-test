// Transport-independent qualification lifecycle. Adapters must use the same
// owner for submission, observation and cancellation. Never retry submission.
export async function qualifySnapshot({ prepare, submit, status, verify, cancel, released, save, sleep, now = Date.now, timeoutMs = 900_000, pollMs = 2000 }) {
  const report = { state: 'FAILED', coverage: 'native-snapshot-transfer', submission: 'NOT_ATTEMPTED', cleanup: 'NOT_REQUESTED' };
  let runId;
  let phase = 'PREPARE';
  try {
    const request = await prepare();
    // Persist reconciliation keys before the external effect. A caller must not
    // start a replacement run if this intent has an ambiguous outcome.
    report.featureRunId = request.stageClaim.featureRunId;
    report.transitionId = request.stageClaim.transitionId;
    report.submission = 'INTENT_RECORDED';
    await save({ ...report });
    phase = 'SUBMIT';
    report.submission = 'AMBIGUOUS';
    const accepted = await submit(request);
    if (typeof accepted.workflowInstanceId !== 'string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(accepted.workflowInstanceId)) {
      throw new Error('invalid acceptance');
    }
    runId = accepted.workflowInstanceId;
    report.workflowInstanceId = runId;
    report.submission = 'ACCEPTED';
    await save({ ...report });
    phase = 'OBSERVE';
    const deadline = now() + timeoutMs;
    for (;;) {
      const current = await status(runId);
      if (current.state === 'COMPLETED') break;
      if (['FAILED', 'CANCELLED', 'CANCELED', 'TERMINATED'].includes(current.state)) throw new Error('terminal failure');
      if (now() >= deadline) throw new Error('qualification timeout');
      await sleep(pollMs);
    }
    phase = 'VERIFY';
    // The adapter must independently compare stored bytes/digest, checkpoint,
    // successful native chunk reports and CONFIRMED per-job cleanup.
    const evidence = await verify(runId, request);
    if (evidence?.verified !== true) throw new Error('verification failed');
    report.artifactVerified = true;
    report.state = 'PASSED';
  } catch {
    // Never persist exception bodies: transport errors may include credentials
    // or private repository content.
    report.failurePhase = phase;
  } finally {
    if (runId) {
      report.cleanup = 'REQUESTED';
      try {
        await cancel(runId);
        const deadline = now() + timeoutMs;
        while (!(await released(runId))) {
          if (now() >= deadline) throw new Error('cleanup timeout');
          await sleep(pollMs);
        }
        report.cleanup = 'CONFIRMED';
      } catch {
        report.cleanup = 'UNCONFIRMED';
        report.state = 'FAILED';
        report.failurePhase ??= 'CLEANUP';
      }
    }
    await save({ ...report });
  }
  return report;
}
