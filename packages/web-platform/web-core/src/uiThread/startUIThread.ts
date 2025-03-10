// Copyright 2023 The Lynx Authors. All rights reserved.
// Licensed under the Apache License Version 2.0 that can be found in the
// LICENSE file in the root directory of this source tree.

import type { LynxView } from '../apis/createLynxView.js';
import { registerLoadNewTagHandler } from './crossThreadHandlers/registerLoadNewTagHandler.js';
import { createExposureService } from './crossThreadHandlers/createExposureService.js';
import { registerInvokeUIMethodHandler } from './crossThreadHandlers/registerInvokeUIMethodHandler.js';
import { registerNativePropsHandler } from './crossThreadHandlers/registerSetNativePropsHandler.js';
import { registerNativeModulesCallHandler } from './crossThreadHandlers/registerNativeModulesCallHandler.js';
import { bootWorkers } from './bootWorkers.js';
import { registerReportErrorHandler } from './crossThreadHandlers/registerReportErrorHandler.js';
import { registerFlushElementTreeHandler } from './crossThreadHandlers/registerFlushElementTreeHandler.js';
import { createDispose } from './crossThreadHandlers/createDispose.js';
import { bootTimingSystem } from './crossThreadHandlers/bootTimingSystem.js';
import { registerTriggerComponentEventHandler } from './crossThreadHandlers/registerTriggerComponentEventHandler.js';
import { registerSelectComponentHandler } from './crossThreadHandlers/registerSelectComponentHandler.js';
import {
  flushElementTreeEndpoint,
  loadNewTagEndpoint,
  mainThreadChunkReadyEndpoint,
  mainThreadStartEndpoint,
  sendGlobalEventEndpoint,
  uiThreadFpReadyEndpoint,
  type MainThreadStartConfigs,
  type NativeModulesCall,
} from '@lynx-js/web-constants';
import { loadTemplate } from '../utils/loadTemplate.js';
import { createUpdateData } from './crossThreadHandlers/createUpdateData.js';

export function startUIThread(
  templateUrl: string,
  configs: Omit<MainThreadStartConfigs, 'template'>,
  rootDom: HTMLElement,
  callbacks: {
    loadNewTag?: (tag: string) => void;
    nativeModulesCall: NativeModulesCall;
    onError?: () => void;
  },
  overrideTagMap: Record<string, string> = {},
  nativeModulesUrl: string | undefined,
): LynxView {
  const createLynxStartTiming = performance.now() + performance.timeOrigin;
  const { entryId } = configs;
  const currentLoadingTags: Promise<void>[] = [];
  const {
    mainThreadRpc,
    backgroundRpc,
    terminateWorkers,
  } = bootWorkers();
  const sendGlobalEvent = backgroundRpc.createCall(sendGlobalEventEndpoint);
  const uiThreadFpReady = backgroundRpc.createCall(uiThreadFpReadyEndpoint);
  const mainThreadStart = mainThreadRpc.createCall(mainThreadStartEndpoint);
  const { markTimingInternal, sendTimingResult } = bootTimingSystem(
    mainThreadRpc,
    backgroundRpc,
    rootDom,
  );
  markTimingInternal('create_lynx_start', undefined, createLynxStartTiming);
  markTimingInternal('load_template_start');
  loadTemplate(templateUrl).then((template) => {
    markTimingInternal('load_template_end');
    mainThreadStart({
      ...configs,
      template,
      nativeModulesUrl,
    });
  });
  registerLoadNewTagHandler(
    mainThreadRpc,
    loadNewTagEndpoint,
    (tag) => {
      if (callbacks.loadNewTag) {
        callbacks.loadNewTag(tag);
      } else {
        if (!customElements.get(tag) && tag.includes('-')) {
          throw new Error(`[lynx-web] cannot find custom element ${tag}`);
        }
      }
    },
    overrideTagMap,
    currentLoadingTags,
  );
  registerReportErrorHandler(
    mainThreadRpc,
    callbacks.onError,
  );
  mainThreadRpc.registerHandler(
    mainThreadChunkReadyEndpoint,
    (mainChunkInfo) => {
      const { pageConfig } = mainChunkInfo;
      registerFlushElementTreeHandler(
        mainThreadRpc,
        flushElementTreeEndpoint,
        {
          pageConfig,
          overrideTagMap,
          backgroundRpc,
          rootDom,
          entryId,
          currentLoadingTags,
        },
        (info) => {
          const { pipelineId, timingFlags, isFP } = info;
          if (isFP) {
            registerInvokeUIMethodHandler(
              backgroundRpc,
              rootDom,
            );
            registerNativePropsHandler(
              backgroundRpc,
              rootDom,
            );
            registerTriggerComponentEventHandler(
              backgroundRpc,
              rootDom,
            );
            registerSelectComponentHandler(
              backgroundRpc,
              rootDom,
            );
            createExposureService(backgroundRpc, rootDom);
            uiThreadFpReady();
          }
          sendTimingResult(pipelineId, timingFlags, isFP);
        },
        markTimingInternal,
      );
    },
  );
  registerNativeModulesCallHandler(
    backgroundRpc,
    callbacks.nativeModulesCall,
  );
  return {
    updateData: createUpdateData(mainThreadRpc, backgroundRpc),
    dispose: createDispose(
      backgroundRpc,
      terminateWorkers,
    ),
    sendGlobalEvent,
  };
}
