import * as THREE from 'three';
import { TrajectoryCalculator } from '../src/physics/TrajectoryCalculator';
import { ImprovedTrajectoryCalculator } from '../src/physics/ImprovedTrajectoryCalculator';

interface BenchmarkResult {
  name: string;
  iterations: number;
  totalTime: number;
  averageTime: number;
  minTime: number;
  maxTime: number;
  standardDeviation: number;
}

class TrajectoryBenchmark {
  private results: BenchmarkResult[] = [];
  
  constructor(private iterations: number = 1000) {}
  
  private measureExecution(fn: () => void, name: string): BenchmarkResult {
    const times: number[] = [];
    
    // Warmup
    for (let i = 0; i < 100; i++) {
      fn();
    }
    
    // Actual benchmark
    for (let i = 0; i < this.iterations; i++) {
      const start = performance.now();
      fn();
      const end = performance.now();
      times.push(end - start);
    }
    
    const totalTime = times.reduce((a, b) => a + b, 0);
    const averageTime = totalTime / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    
    // Calculate standard deviation
    const variance = times.reduce((sum, time) => {
      return sum + Math.pow(time - averageTime, 2);
    }, 0) / times.length;
    const standardDeviation = Math.sqrt(variance);
    
    return {
      name,
      iterations: this.iterations,
      totalTime,
      averageTime,
      minTime,
      maxTime,
      standardDeviation
    };
  }
  
  benchmarkTrajectoryCalculator() {
    console.log('🚀 Benchmarking TrajectoryCalculator...\n');
    const calculator = new TrajectoryCalculator();
    
    // Test 1: Launch Parameters (Short Range)
    const result1 = this.measureExecution(() => {
      const position = new THREE.Vector3(0, 0, 0);
      const target = new THREE.Vector3(100, 0, 100);
      calculator.calculateLaunchParameters(position, target, 50, false);
    }, 'calculateLaunchParameters (short range)');
    this.results.push(result1);
    
    // Test 2: Launch Parameters (Long Range)
    const result2 = this.measureExecution(() => {
      const position = new THREE.Vector3(0, 0, 0);
      const target = new THREE.Vector3(5000, 0, 5000);
      calculator.calculateLaunchParameters(position, target, 300, true);
    }, 'calculateLaunchParameters (long range)');
    this.results.push(result2);
    
    // Test 3: Velocity Vector Conversion
    const launchParams = { angle: Math.PI / 4, heading: 0, velocity: 100, distance: 100 };
    const result3 = this.measureExecution(() => {
      calculator.getVelocityVector(launchParams);
    }, 'getVelocityVector');
    this.results.push(result3);
    
    // Test 4: Trajectory Prediction
    const result4 = this.measureExecution(() => {
      const position = new THREE.Vector3(0, 10, 0);
      const velocity = new THREE.Vector3(50, 50, 0);
      calculator.predictTrajectory(position, velocity);
    }, 'predictTrajectory');
    this.results.push(result4);
    
    // Test 5: Interception (Ballistic)
    const result5 = this.measureExecution(() => {
      const threatPos = new THREE.Vector3(1000, 500, 1000);
      const threatVel = new THREE.Vector3(-100, -50, -100);
      const batteryPos = new THREE.Vector3(0, 0, 0);
      calculator.calculateInterceptionPoint(threatPos, threatVel, batteryPos, 150, false);
    }, 'calculateInterceptionPoint (ballistic)');
    this.results.push(result5);
    
    // Test 6: Interception (Drone)
    const result6 = this.measureExecution(() => {
      const threatPos = new THREE.Vector3(1000, 100, 1000);
      const threatVel = new THREE.Vector3(-50, 0, -50);
      const batteryPos = new THREE.Vector3(0, 0, 0);
      calculator.calculateInterceptionPoint(threatPos, threatVel, batteryPos, 100, true);
    }, 'calculateInterceptionPoint (drone)');
    this.results.push(result6);
  }
  
  benchmarkImprovedTrajectoryCalculator() {
    console.log('\n🚀 Benchmarking ImprovedTrajectoryCalculator...\n');
    const calculator = new ImprovedTrajectoryCalculator();
    
    // Test 1: Interception (Ballistic)
    const result1 = this.measureExecution(() => {
      const threatPos = new THREE.Vector3(1000, 500, 1000);
      const threatVel = new THREE.Vector3(-100, -50, -100);
      const batteryPos = new THREE.Vector3(0, 0, 0);
      calculator.calculateInterceptionPoint(threatPos, threatVel, batteryPos, 150, false);
    }, 'Improved: calculateInterceptionPoint (ballistic)');
    this.results.push(result1);
    
    // Test 2: Interception (Drone)
    const result2 = this.measureExecution(() => {
      const threatPos = new THREE.Vector3(1000, 100, 1000);
      const threatVel = new THREE.Vector3(-50, 0, -50);
      const batteryPos = new THREE.Vector3(0, 0, 0);
      calculator.calculateInterceptionPoint(threatPos, threatVel, batteryPos, 100, true);
    }, 'Improved: calculateInterceptionPoint (drone)');
    this.results.push(result2);
    
    // Test 3: Edge case - High altitude
    const result3 = this.measureExecution(() => {
      const threatPos = new THREE.Vector3(500, 1000, 500);
      const threatVel = new THREE.Vector3(-50, -100, -50);
      const batteryPos = new THREE.Vector3(0, 0, 0);
      calculator.calculateInterceptionPoint(threatPos, threatVel, batteryPos, 200, false);
    }, 'Improved: calculateInterceptionPoint (high altitude)');
    this.results.push(result3);
  }
  
  benchmarkScenarios() {
    console.log('\n🚀 Benchmarking Real-World Scenarios...\n');
    const basicCalc = new TrajectoryCalculator();
    const improvedCalc = new ImprovedTrajectoryCalculator();
    
    // Scenario 1: Salvo of 10 threats
    const threats = Array.from({ length: 10 }, (_, i) => ({
      position: new THREE.Vector3(1000 + i * 100, 200 + i * 50, 1000 + i * 100),
      velocity: new THREE.Vector3(-80 - i * 5, -20 - i * 2, -80 - i * 5)
    }));
    
    const result1 = this.measureExecution(() => {
      threats.forEach(threat => {
        basicCalc.calculateInterceptionPoint(
          threat.position,
          threat.velocity,
          new THREE.Vector3(0, 0, 0),
          150,
          false
        );
      });
    }, 'Scenario: 10 threat salvo (basic)');
    this.results.push(result1);
    
    const result2 = this.measureExecution(() => {
      threats.forEach(threat => {
        improvedCalc.calculateInterceptionPoint(
          threat.position,
          threat.velocity,
          new THREE.Vector3(0, 0, 0),
          150,
          false
        );
      });
    }, 'Scenario: 10 threat salvo (improved)');
    this.results.push(result2);
    
    // Scenario 2: Mixed threat types
    const mixedThreats = [
      { pos: new THREE.Vector3(1000, 500, 1000), vel: new THREE.Vector3(-100, -50, -100), isDrone: false },
      { pos: new THREE.Vector3(800, 100, 800), vel: new THREE.Vector3(-40, 0, -40), isDrone: true },
      { pos: new THREE.Vector3(1200, 300, 1200), vel: new THREE.Vector3(-120, -30, -120), isDrone: false },
      { pos: new THREE.Vector3(600, 80, 600), vel: new THREE.Vector3(-30, 0, -30), isDrone: true },
    ];
    
    const result3 = this.measureExecution(() => {
      mixedThreats.forEach(threat => {
        basicCalc.calculateInterceptionPoint(
          threat.pos,
          threat.vel,
          new THREE.Vector3(0, 0, 0),
          150,
          threat.isDrone
        );
      });
    }, 'Scenario: Mixed threats (basic)');
    this.results.push(result3);
  }
  
  printResults() {
    console.log('\n📊 BENCHMARK RESULTS\n');
    console.log('─'.repeat(80));
    console.log(
      'Method'.padEnd(50) +
      'Avg (ms)'.padEnd(10) +
      'Min (ms)'.padEnd(10) +
      'Max (ms)'.padEnd(10) +
      'Std Dev'
    );
    console.log('─'.repeat(80));
    
    this.results.forEach(result => {
      console.log(
        result.name.padEnd(50) +
        result.averageTime.toFixed(4).padEnd(10) +
        result.minTime.toFixed(4).padEnd(10) +
        result.maxTime.toFixed(4).padEnd(10) +
        result.standardDeviation.toFixed(4)
      );
    });
    
    console.log('─'.repeat(80));
    console.log(`\nTotal iterations per test: ${this.iterations}`);
    
    // Performance comparison
    const basicInterception = this.results.find(r => r.name === 'calculateInterceptionPoint (ballistic)');
    const improvedInterception = this.results.find(r => r.name === 'Improved: calculateInterceptionPoint (ballistic)');
    
    if (basicInterception && improvedInterception) {
      const ratio = improvedInterception.averageTime / basicInterception.averageTime;
      console.log(`\n⚡ Performance Ratio (Improved vs Basic): ${ratio.toFixed(2)}x`);
      console.log(`   Basic: ${basicInterception.averageTime.toFixed(4)}ms`);
      console.log(`   Improved: ${improvedInterception.averageTime.toFixed(4)}ms`);
    }
    
    // Critical performance thresholds
    console.log('\n🎯 Performance Analysis:');
    const criticalMethods = [
      'calculateInterceptionPoint (ballistic)',
      'calculateInterceptionPoint (drone)',
      'predictTrajectory'
    ];
    
    criticalMethods.forEach(method => {
      const result = this.results.find(r => r.name === method);
      if (result) {
        const targetFps = 60;
        const frameTime = 1000 / targetFps;
        const maxCallsPerFrame = Math.floor(frameTime / result.averageTime);
        console.log(`   ${method}: Max ${maxCallsPerFrame} calls/frame @ ${targetFps}fps`);
      }
    });
  }
  
  exportResults(filename: string) {
    const data = {
      timestamp: new Date().toISOString(),
      iterations: this.iterations,
      results: this.results,
      summary: {
        totalTests: this.results.length,
        averageExecutionTime: this.results.reduce((sum, r) => sum + r.averageTime, 0) / this.results.length
      }
    };
    
    const fs = require('fs');
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
    console.log(`\n💾 Results exported to ${filename}`);
  }
}

// Run benchmarks
if (import.meta.main) {
  console.log('🏁 Iron Dome Trajectory System Performance Benchmark\n');
  
  const benchmark = new TrajectoryBenchmark(1000);
  
  try {
    benchmark.benchmarkTrajectoryCalculator();
    benchmark.benchmarkImprovedTrajectoryCalculator();
    benchmark.benchmarkScenarios();
    benchmark.printResults();
    
    // Export results
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    benchmark.exportResults(`trajectory-benchmark-${timestamp}.json`);
  } catch (error) {
    console.error('❌ Benchmark failed:', error);
  }
}