/**
 * Generic Genetic Algorithm Framework for Iron Dome Systems Optimization
 */

import { debug } from '../utils/logger';

export interface Gene {
  name: string;
  min: number;
  max: number;
  step?: number;
  type: 'float' | 'int';
}

export interface Genome {
  genes: Record<string, number>;
  fitness?: number;
  metadata?: any;
}

export interface FitnessFunction {
  (genome: Genome): Promise<number>;
}

export interface GAConfig {
  populationSize: number;
  generations: number;
  mutationRate: number;
  crossoverRate: number;
  elitismRate: number;
  tournamentSize?: number;
  convergenceThreshold?: number;
  verbose?: boolean;
}

export class GeneticAlgorithm {
  private config: GAConfig;
  private geneDefinitions: Gene[];
  private fitnessFunction: FitnessFunction;
  private population: Genome[] = [];
  private generation: number = 0;
  private bestGenome: Genome | null = null;
  private history: {
    generation: number;
    bestFitness: number;
    avgFitness: number;
    bestGenome: Genome;
  }[] = [];

  constructor(genes: Gene[], fitnessFunction: FitnessFunction, config: Partial<GAConfig> = {}) {
    this.geneDefinitions = genes;
    this.fitnessFunction = fitnessFunction;
    this.config = {
      populationSize: 50,
      generations: 100,
      mutationRate: 0.1,
      crossoverRate: 0.7,
      elitismRate: 0.1,
      tournamentSize: 3,
      convergenceThreshold: 0.001,
      verbose: true,
      ...config,
    };
  }

  /**
   * Initialize random population
   */
  private initializePopulation(): void {
    this.population = [];

    for (let i = 0; i < this.config.populationSize; i++) {
      const genome: Genome = { genes: {} };

      for (const geneDef of this.geneDefinitions) {
        const range = geneDef.max - geneDef.min;
        let value = Math.random() * range + geneDef.min;

        if (geneDef.step) {
          value = Math.round(value / geneDef.step) * geneDef.step;
        }

        if (geneDef.type === 'int') {
          value = Math.round(value);
        }

        genome.genes[geneDef.name] = value;
      }

      this.population.push(genome);
    }
  }

  /**
   * Evaluate fitness for entire population
   */
  private async evaluatePopulation(): Promise<void> {
    // Evaluate in parallel for speed
    const evaluations = this.population.map(async genome => {
      if (genome.fitness === undefined) {
        genome.fitness = await this.fitnessFunction(genome);
      }
      return genome;
    });

    this.population = await Promise.all(evaluations);

    // Sort by fitness (higher is better)
    this.population.sort((a, b) => (b.fitness || 0) - (a.fitness || 0));

    // Update best genome
    if (!this.bestGenome || this.population[0].fitness! > this.bestGenome.fitness!) {
      this.bestGenome = { ...this.population[0] };
    }
  }

  /**
   * Tournament selection
   */
  private selectParent(): Genome {
    const tournamentSize = this.config.tournamentSize!;
    let best: Genome | null = null;

    for (let i = 0; i < tournamentSize; i++) {
      const candidate = this.population[Math.floor(Math.random() * this.population.length)];
      if (!best || candidate.fitness! > best.fitness!) {
        best = candidate;
      }
    }

    return best!;
  }

  /**
   * Crossover two parents to create offspring
   */
  private crossover(parent1: Genome, parent2: Genome): Genome {
    const child: Genome = { genes: {} };

    for (const geneDef of this.geneDefinitions) {
      const geneName = geneDef.name;

      // Uniform crossover
      if (Math.random() < 0.5) {
        child.genes[geneName] = parent1.genes[geneName];
      } else {
        child.genes[geneName] = parent2.genes[geneName];
      }

      // Alternative: blend crossover for continuous values
      // const alpha = Math.random()
      // child.genes[geneName] = alpha * parent1.genes[geneName] + (1 - alpha) * parent2.genes[geneName]
    }

    return child;
  }

  /**
   * Mutate a genome
   */
  private mutate(genome: Genome): void {
    for (const geneDef of this.geneDefinitions) {
      if (Math.random() < this.config.mutationRate) {
        const geneName = geneDef.name;
        const range = geneDef.max - geneDef.min;

        // Gaussian mutation
        const mutation = (Math.random() - 0.5) * range * 0.2;
        let newValue = genome.genes[geneName] + mutation;

        // Clamp to bounds
        newValue = Math.max(geneDef.min, Math.min(geneDef.max, newValue));

        // Apply step if defined
        if (geneDef.step) {
          newValue = Math.round(newValue / geneDef.step) * geneDef.step;
        }

        if (geneDef.type === 'int') {
          newValue = Math.round(newValue);
        }

        genome.genes[geneName] = newValue;
      }
    }
  }

  /**
   * Create next generation
   */
  private async createNextGeneration(): Promise<void> {
    const newPopulation: Genome[] = [];

    // Elitism: keep best individuals
    const eliteCount = Math.floor(this.config.populationSize * this.config.elitismRate);
    for (let i = 0; i < eliteCount; i++) {
      newPopulation.push({ ...this.population[i], fitness: undefined });
    }

    // Create rest through crossover and mutation
    while (newPopulation.length < this.config.populationSize) {
      if (Math.random() < this.config.crossoverRate) {
        // Crossover
        const parent1 = this.selectParent();
        const parent2 = this.selectParent();
        const child = this.crossover(parent1, parent2);
        this.mutate(child);
        newPopulation.push(child);
      } else {
        // Direct reproduction with mutation
        const parent = this.selectParent();
        const child = { ...parent, fitness: undefined };
        this.mutate(child);
        newPopulation.push(child);
      }
    }

    this.population = newPopulation;
  }

  /**
   * Check for convergence
   */
  private hasConverged(): boolean {
    if (this.history.length < 10) return false;

    // Check if best fitness hasn't improved significantly in last 10 generations
    const recent = this.history.slice(-10);
    const firstBest = recent[0].bestFitness;
    const lastBest = recent[recent.length - 1].bestFitness;

    return Math.abs(lastBest - firstBest) < this.config.convergenceThreshold!;
  }

  /**
   * Run the genetic algorithm
   */
  async run(): Promise<{
    bestGenome: Genome;
    history: typeof this.history;
    converged: boolean;
  }> {
    // Initialize
    this.generation = 0;
    this.history = [];
    this.bestGenome = null;
    this.initializePopulation();

    // Main evolution loop
    for (let gen = 0; gen < this.config.generations; gen++) {
      this.generation = gen;

      // Evaluate fitness
      await this.evaluatePopulation();

      // Calculate statistics
      const fitnesses = this.population.map(g => g.fitness || 0);
      const avgFitness = fitnesses.reduce((a, b) => a + b, 0) / fitnesses.length;
      const bestFitness = fitnesses[0];

      // Record history
      this.history.push({
        generation: gen,
        bestFitness,
        avgFitness,
        bestGenome: { ...this.population[0] },
      });

      // Log progress
      if (this.config.verbose && gen % 10 === 0) {
        debug.log(
          `Generation ${gen}: Best fitness = ${bestFitness.toFixed(4)}, Avg = ${avgFitness.toFixed(4)}`
        );
        debug.log(`  Best genome:`, this.formatGenome(this.population[0]));
      }

      // Check convergence
      if (this.hasConverged()) {
        if (this.config.verbose) {
          debug.log(`Converged at generation ${gen}`);
        }
        break;
      }

      // Create next generation
      if (gen < this.config.generations - 1) {
        await this.createNextGeneration();
      }
    }

    return {
      bestGenome: this.bestGenome!,
      history: this.history,
      converged: this.hasConverged(),
    };
  }

  /**
   * Format genome for display
   */
  private formatGenome(genome: Genome): string {
    const parts: string[] = [];
    for (const [gene, value] of Object.entries(genome.genes)) {
      parts.push(`${gene}=${typeof value === 'number' ? value.toFixed(2) : value}`);
    }
    return parts.join(', ');
  }

  /**
   * Get current best genome
   */
  getBestGenome(): Genome | null {
    return this.bestGenome;
  }

  /**
   * Get evolution history
   */
  getHistory(): typeof this.history {
    return this.history;
  }
}
