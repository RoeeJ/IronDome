import './setup';
import * as THREE from 'three';
import { TrajectoryCalculator } from '../src/utils/TrajectoryCalculator';
import { ImprovedTrajectoryCalculator } from '../src/utils/ImprovedTrajectoryCalculator';
import { UnifiedTrajectorySystem } from '../src/systems/UnifiedTrajectorySystem';

interface PerformanceResult {
  system: string;
  operation: string;
  iterations: number;
  totalTime: number;
  averageTime: number;
  opsPerSecond: number;
}

class PerformanceComparison {
  private results: PerformanceResult[] = [];
  private iterations = 10000;
  
  runComparison() {
    console.log('🚀 Running Performance Comparison\n');
    console.log(`Iterations per test: ${this.iterations}\n`);
    
    // Test scenarios
    const scenarios = [
      {
        name: 'Simple Interception',
        threatPos: new THREE.Vector3(100, 50, 100),
        threatVel: new THREE.Vector3(-20, -10, -20),
        batteryPos: new THREE.Vector3(0, 0, 0),
        interceptorSpeed: 150,
        isDrone: false
      },
      {
        name: 'Drone Interception',
        threatPos: new THREE.Vector3(200, 100, 200),
        threatVel: new THREE.Vector3(-30, 0, -30),
        batteryPos: new THREE.Vector3(0, 0, 0),
        interceptorSpeed: 100,
        isDrone: true
      },
      {
        name: 'Long Range',
        threatPos: new THREE.Vector3(1000, 500, 1000),
        threatVel: new THREE.Vector3(-100, -50, -100),
        batteryPos: new THREE.Vector3(0, 0, 0),
        interceptorSpeed: 200,
        isDrone: false
      }
    ];
    
    // Test each scenario
    scenarios.forEach(scenario => {
      console.log(`\n📊 Testing: ${scenario.name}`);
      console.log('─'.repeat(50));
      
      // Test original TrajectoryCalculator
      this.testSystem(
        'TrajectoryCalculator',
        scenario.name,
        () => {
          TrajectoryCalculator.calculateInterceptionPoint(
            scenario.threatPos,
            scenario.threatVel,
            scenario.batteryPos,
            scenario.interceptorSpeed,
            scenario.isDrone
          );
        }
      );
      
      // Test ImprovedTrajectoryCalculator
      this.testSystem(
        'ImprovedTrajectoryCalculator',
        scenario.name,
        () => {
          ImprovedTrajectoryCalculator.calculateInterceptionPoint(
            scenario.threatPos,
            scenario.threatVel,
            scenario.batteryPos,
            scenario.interceptorSpeed,
            scenario.isDrone
          );
        }
      );
      
      // Test UnifiedTrajectorySystem - Basic Mode
      const unifiedBasic = new UnifiedTrajectorySystem({ mode: 'basic' });
      this.testSystem(
        'UnifiedSystem (Basic)',
        scenario.name,
        () => {
          unifiedBasic.calculateInterceptionPoint(
            scenario.threatPos,
            scenario.threatVel,
            scenario.batteryPos,
            scenario.interceptorSpeed,
            scenario.isDrone
          );
        }
      );
      
      // Test UnifiedTrajectorySystem - Improved Mode
      const unifiedImproved = new UnifiedTrajectorySystem({ mode: 'improved' });
      this.testSystem(
        'UnifiedSystem (Improved)',
        scenario.name,
        () => {
          unifiedImproved.calculateInterceptionPoint(
            scenario.threatPos,
            scenario.threatVel,
            scenario.batteryPos,
            scenario.interceptorSpeed,
            scenario.isDrone
          );
        }
      );
    });
    
    this.printSummary();
  }
  
  private testSystem(systemName: string, scenario: string, fn: () => void) {
    // Warmup
    for (let i = 0; i < 100; i++) {
      fn();
    }
    
    // Actual test
    const start = performance.now();
    for (let i = 0; i < this.iterations; i++) {
      fn();
    }
    const totalTime = performance.now() - start;
    
    const result: PerformanceResult = {
      system: systemName,
      operation: scenario,
      iterations: this.iterations,
      totalTime,
      averageTime: totalTime / this.iterations,
      opsPerSecond: (this.iterations / totalTime) * 1000
    };
    
    this.results.push(result);
    
    console.log(`${systemName.padEnd(30)} ${result.averageTime.toFixed(4)}ms avg, ${result.opsPerSecond.toFixed(0)} ops/sec`);
  }
  
  private printSummary() {
    console.log('\n\n📈 PERFORMANCE SUMMARY');
    console.log('═'.repeat(80));
    
    // Group by scenario
    const scenarios = [...new Set(this.results.map(r => r.operation))];
    
    scenarios.forEach(scenario => {
      console.log(`\n${scenario}:`);
      console.log('─'.repeat(60));
      
      const scenarioResults = this.results.filter(r => r.operation === scenario);
      const baseline = scenarioResults.find(r => r.system === 'TrajectoryCalculator');
      
      if (baseline) {
        scenarioResults.forEach(result => {
          const ratio = result.averageTime / baseline.averageTime;
          const performance = ratio < 1 ? 
            `${((1 - ratio) * 100).toFixed(1)}% faster` : 
            `${((ratio - 1) * 100).toFixed(1)}% slower`;
          
          console.log(
            `${result.system.padEnd(30)} ` +
            `${result.averageTime.toFixed(4)}ms ` +
            `(${performance} than baseline)`
          );
        });
      }
    });
    
    // Overall statistics
    console.log('\n\n📊 OVERALL PERFORMANCE METRICS');
    console.log('─'.repeat(60));
    
    // Calculate averages by system
    const systems = [...new Set(this.results.map(r => r.system))];
    systems.forEach(system => {
      const systemResults = this.results.filter(r => r.system === system);
      const avgTime = systemResults.reduce((sum, r) => sum + r.averageTime, 0) / systemResults.length;
      const avgOps = systemResults.reduce((sum, r) => sum + r.opsPerSecond, 0) / systemResults.length;
      
      console.log(
        `${system.padEnd(30)} ` +
        `Avg: ${avgTime.toFixed(4)}ms, ` +
        `${avgOps.toFixed(0)} ops/sec`
      );
    });
    
    // Migration impact
    console.log('\n\n🔄 MIGRATION IMPACT');
    console.log('─'.repeat(60));
    
    const originalAvg = this.results
      .filter(r => r.system === 'TrajectoryCalculator')
      .reduce((sum, r) => sum + r.averageTime, 0) / scenarios.length;
      
    const unifiedBasicAvg = this.results
      .filter(r => r.system === 'UnifiedSystem (Basic)')
      .reduce((sum, r) => sum + r.averageTime, 0) / scenarios.length;
      
    const overhead = ((unifiedBasicAvg - originalAvg) / originalAvg) * 100;
    
    console.log(`UnifiedSystem (Basic mode) adds ${overhead.toFixed(2)}% overhead vs original`);
    console.log(`This translates to ${(unifiedBasicAvg - originalAvg).toFixed(4)}ms per operation`);
    
    // Recommendations
    console.log('\n\n💡 RECOMMENDATIONS');
    console.log('─'.repeat(60));
    
    if (overhead < 5) {
      console.log('✅ Performance overhead is negligible - safe to migrate');
    } else if (overhead < 10) {
      console.log('⚠️  Minor performance overhead - monitor in production');
    } else {
      console.log('❌ Significant performance overhead - optimization needed');
    }
    
    console.log('\nFor maximum performance:');
    console.log('- Use basic mode for high-frequency calculations');
    console.log('- Use improved mode only for critical threats');
    console.log('- Consider caching results for static scenarios');
  }
}

// Run the comparison
if (import.meta.main) {
  const comparison = new PerformanceComparison();
  comparison.runComparison();
}