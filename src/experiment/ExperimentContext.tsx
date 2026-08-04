import React, { createContext, useContext, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { resolveMediaSettings, type ResolvedMediaSettings } from '../core/settings';
import type { ClientCapabilities } from '../core/capabilities';
import { ExperimentWorld } from './world';
import { DEFAULT_SCENARIO, loadScenario, type Scenario } from './scenarios';

interface ExperimentValue extends ResolvedMediaSettings {
  world: ExperimentWorld;
  capabilities: ClientCapabilities;
  scenario: Scenario;
  setScenario(scenario: Scenario): void;
  revision: number;
}

const ExperimentContext = createContext<ExperimentValue | null>(null);

export function ExperimentProvider({ children }: { children: React.ReactNode }) {
  const worldRef = useRef<ExperimentWorld | null>(null);
  if (worldRef.current === null) {
    worldRef.current = new ExperimentWorld();
    loadScenario(worldRef.current, DEFAULT_SCENARIO);
  }
  const world = worldRef.current;

  const [scenario, setScenarioState] = useState<Scenario>(DEFAULT_SCENARIO);
  const revision = useSyncExternalStore(world.subscribe, world.getRevision, world.getRevision);

  const value = useMemo<ExperimentValue>(() => {
    const resolved = resolveMediaSettings(world.stateStore, world.capabilities);
    return {
      ...resolved,
      world,
      revision,
      capabilities: world.capabilities,
      scenario,
      setScenario(next: Scenario) {
        loadScenario(world, next);
        setScenarioState(next);
      },
    };
  }, [world, revision, scenario]);

  return <ExperimentContext.Provider value={value}>{children}</ExperimentContext.Provider>;
}

export function useExperiment(): ExperimentValue {
  const value = useContext(ExperimentContext);
  if (!value) throw new Error('useExperiment must be used inside <ExperimentProvider>');
  return value;
}
