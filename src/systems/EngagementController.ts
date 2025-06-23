import * as THREE from 'three';
import { Threat } from '@/entities/Threat';
import { IronDomeBattery } from '@/entities/IronDomeBattery';
import { ThreatAssessment } from './ThreatAnalyzer';
import { debug } from '@/utils/DebugLogger';

export interface Engagement {
  id: string;
  threat: Threat;
  battery: IronDomeBattery;
  interceptors: string[];
  strategy: 'single' | 'salvo' | 'shoot-look-shoot';
  status: 'active' | 'assessing' | 'completed' | 'failed';
  startTime: number;
  assessmentTime?: number;
  secondShotTime?: number;
  result?: 'hit' | 'miss' | 'pending';
}

export interface SalvoAssignment {
  threat: Threat;
  interceptorCount: number;
  battery: IronDomeBattery;
  firingDelay: number; // milliseconds between shots
}

export interface EngagementPlan {
  assignments: SalvoAssignment[];
  totalInterceptors: number;
  expectedSuccessRate: number;
  timeToExecute: number;
}

export class EngagementController {
  private activeEngagements: Map<string, Engagement> = new Map();
  private pendingAssessments: Map<string, Engagement> = new Map();
  private readonly assessmentDelay = 2000; // ms to assess first shot
  private readonly secondShotWindow = 3000; // ms window for second shot

  // Learning system for adaptive engagement
  private engagementHistory: Map<string, { attempts: number; hits: number }> = new Map();

  executeEngagement(
    assessment: ThreatAssessment,
    battery: IronDomeBattery,
    strategy: 'single' | 'salvo' | 'shoot-look-shoot' = 'single'
  ): Engagement | null {
    // Check if already engaged
    if (this.isEngaged(assessment.threat)) {
      debug.module('Engagement').log(`Threat ${assessment.threat.id} already engaged`);
      return null;
    }

    const engagement: Engagement = {
      id: `eng_${Date.now()}_${assessment.threat.id}`,
      threat: assessment.threat,
      battery,
      interceptors: [],
      strategy,
      status: 'active',
      startTime: Date.now(),
    };

    switch (strategy) {
      case 'single':
        this.executeSingleShot(engagement, assessment);
        break;

      case 'salvo':
        this.executeSalvo(engagement, assessment);
        break;

      case 'shoot-look-shoot':
        this.executeShootLookShoot(engagement, assessment);
        break;
    }

    this.activeEngagements.set(engagement.id, engagement);
    return engagement;
  }

  private executeSingleShot(engagement: Engagement, assessment: ThreatAssessment): void {
    const interceptorId = this.fireInterceptor(engagement.battery, assessment.threat);
    if (interceptorId) {
      engagement.interceptors.push(interceptorId);
      debug
        .module('Engagement')
        .log(`Single shot engagement ${engagement.id}: fired interceptor ${interceptorId}`);
    }
  }

  private executeSalvo(engagement: Engagement, assessment: ThreatAssessment): void {
    const count = assessment.requiredInterceptors;
    const delay = 500; // ms between shots

    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const interceptorId = this.fireInterceptor(engagement.battery, assessment.threat);
        if (interceptorId) {
          engagement.interceptors.push(interceptorId);
          debug
            .module('Engagement')
            .log(`Salvo shot ${i + 1}/${count} for engagement ${engagement.id}`);
        }
      }, i * delay);
    }
  }

  private executeShootLookShoot(engagement: Engagement, assessment: ThreatAssessment): void {
    // Fire first interceptor
    const firstInterceptor = this.fireInterceptor(engagement.battery, assessment.threat);
    if (!firstInterceptor) {
      engagement.status = 'failed';
      return;
    }

    engagement.interceptors.push(firstInterceptor);
    engagement.status = 'assessing';
    engagement.assessmentTime = Date.now() + this.assessmentDelay;

    // Schedule assessment
    this.pendingAssessments.set(engagement.id, engagement);

    debug
      .module('Engagement')
      .log(
        `Shoot-look-shoot engagement ${engagement.id}: first shot fired, assessment in ${this.assessmentDelay}ms`
      );
  }

  update(interceptors: any[], threats: Threat[]): void {
    const now = Date.now();

    // Process pending assessments
    this.pendingAssessments.forEach((engagement, id) => {
      if (engagement.assessmentTime && now >= engagement.assessmentTime) {
        this.assessFirstShot(engagement, interceptors, threats);
        this.pendingAssessments.delete(id);
      }
    });

    // Update active engagements
    this.activeEngagements.forEach(engagement => {
      if (engagement.status === 'completed' || engagement.status === 'failed') {
        return;
      }

      // Check for interception success
      const result = this.checkInterceptionResult(engagement, interceptors, threats);
      if (result !== 'pending') {
        engagement.result = result;
        engagement.status = 'completed';
        this.updateLearningData(engagement);
      }
    });

    // Clean up old engagements
    this.cleanupEngagements();
  }

  private assessFirstShot(engagement: Engagement, interceptors: any[], threats: Threat[]): void {
    // Check if first interceptor is still tracking
    const firstInterceptor = interceptors.find(i => i.id === engagement.interceptors[0]);
    const threat = threats.find(t => t.id === engagement.threat.id);

    if (!threat || !threat.active) {
      // Threat already destroyed
      engagement.status = 'completed';
      engagement.result = 'hit';
      return;
    }

    if (!firstInterceptor || !firstInterceptor.active) {
      // First interceptor missed or was destroyed
      // Check if we still have time for second shot
      const timeToImpact = threat.getTimeToImpact();

      if (timeToImpact > 5) {
        // Fire second interceptor
        const secondInterceptor = this.fireInterceptor(engagement.battery, threat);
        if (secondInterceptor) {
          engagement.interceptors.push(secondInterceptor);
          engagement.secondShotTime = Date.now();
          engagement.status = 'active';

          debug
            .module('Engagement')
            .log(`Shoot-look-shoot ${engagement.id}: second shot fired after miss assessment`);
        }
      } else {
        // No time for second shot
        engagement.status = 'completed';
        engagement.result = 'miss';
      }
    } else {
      // First interceptor still active, wait for result
      engagement.status = 'active';
    }
  }

  private checkInterceptionResult(
    engagement: Engagement,
    interceptors: any[],
    threats: Threat[]
  ): 'hit' | 'miss' | 'pending' {
    const threat = threats.find(t => t.id === engagement.threat.id);

    // If threat is gone, it was hit
    if (!threat || !threat.active) {
      return 'hit';
    }

    // Check if all interceptors are gone
    const activeInterceptors = engagement.interceptors.filter(id =>
      interceptors.some(i => i.id === id && i.active)
    );

    if (activeInterceptors.length === 0) {
      // All interceptors expended
      return threat.active ? 'miss' : 'hit';
    }

    return 'pending';
  }

  optimizeSalvoEngagement(
    assessments: ThreatAssessment[],
    batteries: IronDomeBattery[],
    availableInterceptors: number
  ): EngagementPlan {
    // Dynamic programming approach to optimize interceptor allocation
    const assignments: SalvoAssignment[] = [];
    let remainingInterceptors = availableInterceptors;
    let totalExpectedHits = 0;

    // Sort threats by priority-to-interceptor ratio
    const sortedAssessments = assessments.sort((a, b) => {
      const ratioA = a.priority / a.requiredInterceptors;
      const ratioB = b.priority / b.requiredInterceptors;
      return ratioB - ratioA;
    });

    for (const assessment of sortedAssessments) {
      if (remainingInterceptors <= 0) break;

      // Find best battery for this threat
      const battery = this.selectOptimalBattery(assessment.threat, batteries);
      if (!battery) continue;

      // Determine interceptor allocation
      let allocation = assessment.requiredInterceptors;

      // Adjust based on learning data
      const historyKey = `${assessment.threat.type}_${battery.config.id}`;
      const history = this.engagementHistory.get(historyKey);

      if (history && history.attempts > 5) {
        const historicalPk = history.hits / history.attempts;
        if (historicalPk < 0.7) {
          // Poor historical performance, add extra interceptor
          allocation = Math.min(allocation + 1, 4);
        } else if (historicalPk > 0.9) {
          // Good historical performance, maybe use fewer
          allocation = Math.max(allocation - 1, 1);
        }
      }

      // Check if we have enough interceptors
      allocation = Math.min(allocation, remainingInterceptors);

      if (allocation > 0) {
        assignments.push({
          threat: assessment.threat,
          interceptorCount: allocation,
          battery,
          firingDelay: 500,
        });

        remainingInterceptors -= allocation;
        totalExpectedHits += assessment.interceptProbability;
      }
    }

    return {
      assignments,
      totalInterceptors: availableInterceptors - remainingInterceptors,
      expectedSuccessRate: totalExpectedHits / assessments.length,
      timeToExecute: Math.max(...assignments.map(a => a.interceptorCount * a.firingDelay)),
    };
  }

  private selectOptimalBattery(
    threat: Threat,
    batteries: IronDomeBattery[]
  ): IronDomeBattery | null {
    let bestBattery: IronDomeBattery | null = null;
    let bestScore = 0;

    for (const battery of batteries) {
      if (!battery.canIntercept(threat)) continue;

      const distance = threat.getPosition().distanceTo(battery.getPosition());
      const loadFactor = battery.getInterceptorCount() / battery.config.maxInterceptors;

      // Score based on distance and availability
      const score = (1 - distance / battery.config.maxRange) * loadFactor;

      if (score > bestScore) {
        bestScore = score;
        bestBattery = battery;
      }
    }

    return bestBattery;
  }

  private fireInterceptor(battery: IronDomeBattery, threat: Threat): string | null {
    // This would interface with the actual battery firing mechanism
    // For now, return a mock interceptor ID
    const interceptorId = `int_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // In real implementation:
    // battery.fireInterceptor(threat, interceptorId)

    return interceptorId;
  }

  private updateLearningData(engagement: Engagement): void {
    const key = `${engagement.threat.type}_${engagement.battery.config.id}`;
    const history = this.engagementHistory.get(key) || { attempts: 0, hits: 0 };

    history.attempts++;
    if (engagement.result === 'hit') {
      history.hits++;
    }

    this.engagementHistory.set(key, history);

    debug.module('Engagement').log(`Updated learning data for ${key}:`, {
      attempts: history.attempts,
      hits: history.hits,
      pk: (history.hits / history.attempts).toFixed(3),
    });
  }

  private isEngaged(threat: Threat): boolean {
    for (const engagement of this.activeEngagements.values()) {
      if (
        engagement.threat.id === threat.id &&
        (engagement.status === 'active' || engagement.status === 'assessing')
      ) {
        return true;
      }
    }
    return false;
  }

  private cleanupEngagements(): void {
    const now = Date.now();
    const maxAge = 30000; // 30 seconds

    this.activeEngagements.forEach((engagement, id) => {
      if (engagement.status === 'completed' || engagement.status === 'failed') {
        if (now - engagement.startTime > maxAge) {
          this.activeEngagements.delete(id);
        }
      }
    });
  }

  getActiveEngagements(): Engagement[] {
    return Array.from(this.activeEngagements.values()).filter(
      e => e.status === 'active' || e.status === 'assessing'
    );
  }

  getEngagementStats(): {
    totalEngagements: number;
    activeEngagements: number;
    successRate: number;
    averageInterceptorsPerThreat: number;
  } {
    const total = this.activeEngagements.size;
    const active = this.getActiveEngagements().length;
    const completed = Array.from(this.activeEngagements.values()).filter(
      e => e.status === 'completed'
    );

    const hits = completed.filter(e => e.result === 'hit').length;
    const successRate = completed.length > 0 ? hits / completed.length : 0;

    const totalInterceptors = Array.from(this.activeEngagements.values()).reduce(
      (sum, e) => sum + e.interceptors.length,
      0
    );

    return {
      totalEngagements: total,
      activeEngagements: active,
      successRate,
      averageInterceptorsPerThreat: total > 0 ? totalInterceptors / total : 0,
    };
  }
}
