/* @flow */

import type Watcher from './watcher'
import config from '../config'
import { callHook, activateChildComponent } from '../instance/lifecycle'

import {
  warn,
  nextTick,
  devtools,
  handleError
} from '../util/index'

export const MAX_UPDATE_COUNT = 100

const queue: Array<Watcher> = []
const activatedChildren: Array<Component> = []
let has: { [key: number]: ?true } = {}
let circular: { [key: number]: number } = {}
let waiting = false
let flushing = false
let insideRun = false
let index = 0
const afterFlushCallbacks: Array<Function> = []

/**
 * Reset the scheduler's state.
 */
function resetSchedulerState () {
  // if we got to the end of the queue, we can just empty the queue
  if (index === queue.length) {
  queue.length = activatedChildren.length = 0
  // else, we only remove watchers we ran
  } else {
    queue.splice(0, index)
    activatedChildren.splice(0, index)
  }
  has = {}
  if (process.env.NODE_ENV !== 'production') {
    circular = {}
  }
  waiting = flushing = false
}

/**
 * Flush both queues and run the watchers.
 */
function flushSchedulerQueue () {
  if (flushing) {
    throw new Error('Cannot flush while already flushing.')
  }

  if (insideRun) {
    throw new Error('Cannot flush while running a watcher.')
  }

  flushing = true
  let watcher, id
  let hookIndex

  // a watcher's run can throw
  try {
    // Sort queue before flush.
    // This ensures that:
    // 1. Components are updated from parent to child. (because parent is always
    //    created before the child)
    // 2. A component's user watchers are run before its render watcher (because
    //    user watchers are created before the render watcher)
    // 3. If a component is destroyed during a parent component's watcher run,
    //    its watchers can be skipped.
    queue.sort((a, b) => a.id - b.id)

    index = 0
    while (queue.length - index || afterFlushCallbacks.length) {
      // do not cache length because more watchers might be pushed
      // as we run existing watchers
      for (; index < queue.length; index++) {
        watcher = queue[index]
        id = watcher.id
        has[id] = null
        watcher.run()
        // in dev build, check and stop circular updates.
        if (process.env.NODE_ENV !== 'production' && has[id] != null) {
          circular[id] = (circular[id] || 0) + 1
          if (circular[id] > MAX_UPDATE_COUNT) {
            warn(
              'You may have an infinite update loop ' + (
                watcher.user
                  ? `in watcher with expression "${watcher.expression}"`
                  : `in a component render function.`
              ),
              watcher.vm
            )
            // to remove the whole current queue
            index = queue.length
            break
          }
        }
      }

      if (afterFlushCallbacks.length) {
        // call one afterFlush callback, which may queue more watchers
        // TODO: Optimize to not modify array at every run.
        const func = afterFlushCallbacks.shift()
        try {
          func()
        } catch (e) {
          handleError(e, null, `Error in an after flush callback.`)
        }
      }
    }
  } finally {

    // keep copies of post queues before resetting state
    const activatedQueue = activatedChildren.slice()
    // reset scheduler before updated hook called
    hookIndex = index
    const updatedQueue = queue.slice(0, hookIndex)

    resetSchedulerState()


      // call component updated and activated hooks
    callActivatedHooks(activatedQueue)
    callUpdateHooks(updatedQueue)

    // devtool hook
    /* istanbul ignore if */
    if (devtools && config.devtools) {
      devtools.emit('flush')
    }
  }
}

/**
 * Queue the flush.
 */
function requireFlush () {
  if (!waiting) {
    waiting = true
    nextTick(flushSchedulerQueue)
  }
}

function callUpdateHooks (queue) {
  let i = queue.length
  while (i--) {
    const watcher = queue[i]
    const vm = watcher.vm
    if (vm._watcher === watcher && vm._isMounted) {
      callHook(vm, 'updated')
    }
  }
}

/**
 * Queue a kept-alive component that was activated during patch.
 * The queue will be processed after the entire tree has been patched.
 */
export function queueActivatedComponent (vm: Component) {
  // setting _inactive to false here so that a render function can
  // rely on checking whether it's in an inactive tree (e.g. router-view)
  vm._inactive = false
  activatedChildren.push(vm)
}

function callActivatedHooks (queue) {
  for (let i = 0; i < queue.length; i++) {
    queue[i]._inactive = true
    activateChildComponent(queue[i], true /* true */)
  }
}

/**
 * Push a watcher into the watcher queue.
 * Jobs with duplicate IDs will be skipped unless it's
 * pushed when the queue is being flushed.
 */
export function queueWatcher (watcher: Watcher) {
  const id = watcher.id
  if (has[id] == null) {
    has[id] = true
    if (!flushing) {
      queue.push(watcher)
    } else {
      // if already flushing, splice the watcher based on its id
      // if already past its id, it will be run next immediately.
      let i = queue.length - 1
      while (i >= 0 && queue[i].id > watcher.id) {
        i--
      }
      queue.splice(Math.max(i, index) + 1, 0, watcher)
    }
    requireFlush()
  }
}

/**
 * Schedules a function to be called after the next flush, or later in the
 * current flush if one is in progress, after all watchers have been rerun.
 * The function will be run once and not on subsequent flushes unless
 * `afterFlush` is called again.
 */
export function afterFlush (f: Function) {
  afterFlushCallbacks.push(f)
  requireFlush()
}

/**
 * Forces a synchronous flush.
 */
export function forceFlush (maxUpdateCount?: number) {
  flushSchedulerQueue(maxUpdateCount)
}

/**
 * Used in watchers to wrap provided getters to set scheduler flags.
 */
export function wrapWatcherGetter (f: Function): Function {
  return function (/* args */) {
    const previousInsideRun = insideRun
    insideRun = true
    try {
      return f.apply(this, arguments)
    } finally {
      insideRun = previousInsideRun
    }
  }
}
