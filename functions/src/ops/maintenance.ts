// The maintenance run: every scheduled task in one Cloud Scheduler job.
//
// Cloud Scheduler gives each billing account 3 free jobs a month and charges for each
// job beyond them, so Solara keeps its background work in one job that runs every five
// minutes, leaving room for the morning alerts job (roadmap item 10). Each task is
// isolated: one failing never stops the others, and every failure is reported at the
// end so the run, and its alert, fail visibly.

import { logger } from 'firebase-functions/logger'

import { loggableError } from '../shared/errors'

export interface MaintenanceTask {
  name: string
  run: () => Promise<unknown>
}

export interface MaintenanceOutcome {
  name: string
  ok: boolean
  result?: unknown
}

/** Runs every task in order; throws an AggregateError naming the failed ones. */
export async function runMaintenance(tasks: MaintenanceTask[]): Promise<MaintenanceOutcome[]> {
  const outcomes: MaintenanceOutcome[] = []
  const failures: Error[] = []
  for (const task of tasks) {
    try {
      outcomes.push({ name: task.name, ok: true, result: await task.run() })
    } catch (error) {
      const causes = error instanceof AggregateError ? error.errors : [error]
      logger.error(`maintenance task ${task.name} failed`, {
        task: task.name,
        errors: causes.map(failure => ({
          ...loggableError(failure),
          cause: loggableError((failure as { cause?: unknown } | null)?.cause),
        })),
      })
      outcomes.push({ name: task.name, ok: false })
      failures.push(new Error(`maintenance task ${task.name} failed`, { cause: error }))
    }
  }
  logger.info('maintenance run completed', { outcomes })
  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} maintenance task(s) failed`)
  }
  return outcomes
}
