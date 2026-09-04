import { describe, expect, test } from 'bun:test';
import { Box3, BufferAttribute, InstancedMesh, Matrix4, Scene, Vector3 } from 'three';
import { BuildingSystem } from '@/world/BuildingSystem';
import { InstancedBuildingRenderer } from '@/rendering/InstancedBuildingRenderer';
import { InstancedThreatRenderer } from '@/rendering/InstancedThreatRenderer';
import { PooledTrailSystem } from '@/rendering/PooledTrailSystem';
import { sweptSphereBoxContact } from '@/physics/collision';
import { Threat, ThreatType } from '@/entities/Threat';
import { simulationClock } from '@/simulation/SimulationClock';
const V = (x = 0, y = 0, z = 0) => new Vector3(x, y, z);

describe('Audit: authoritative city geometry and health', () => {
  for (const instanced of [false, true]) {
    test(`queries and damage work with instancing=${instanced}`, () => {
      const scene = new Scene();
      const city = new BuildingSystem(scene, instanced);
      const id = city.createBuilding(V(100, 5), 20, 150, 30);
      expect(city.getAllBuildings()).toHaveLength(1);
      expect(city.getBuildingAt(V(109, 150, 14), 0)?.id).toBe(id);
      expect(city.getBuildingAt(V(111, 150), 0)).toBeNull();
      city.damageBuilding(id, 25);
      expect(city.getAllBuildings()[0].health).toBe(75);
      city.checkExplosionDamage(V(100, 100), 10);
      expect(city.getAllBuildings()[0].health).toBe(25);
      city.damageBuilding(id, 1000);
      expect(city.getAllBuildings()).toHaveLength(0);
      expect(city.getBuildingAt(V(100, 100), 0)).toBeNull();
      city.dispose();
    });
  }
  test('sweep uses actual height, earliest contact and finite projectile radius', () => {
    const city = new BuildingSystem(new Scene());
    city.createBuilding(V(0), 10, 10, 10);
    const tall = city.createBuilding(V(30), 10, 150, 10);
    const hit = city.findFirstCollision(V(-30, 110), V(50, 110), 1)!;
    expect(hit.building.id).toBe(tall);
    expect(hit.position.x).toBeCloseTo(24, 10);
    expect(city.findFirstCollision(V(-30, 50), V(10, 50), 1)).toBeNull();
    city.dispose();
  });
  test('rounded box corner does not produce expanded-box false positives', () => {
    const box = new Box3(V(-1, -1, -1), V(1, 1, 1));
    expect(sweptSphereBoxContact(V(-3, 1.9, 1.9), V(3, 1.9, 1.9), 1, box)).toBeNull();
    const t = sweptSphereBoxContact(V(-3, 1.6, 1.6), V(3, 1.6, 1.6), 1, box)!;
    expect(t).toBeCloseTo((2 - Math.sqrt(0.28)) / 6, 9);
    expect(sweptSphereBoxContact(V(), V(), 1, box)).toBe(0);
  });
  test('unchanged city hour is throttled; explicit time edits update immediately', () => {
    simulationClock.reset();
    const city = new BuildingSystem(new Scene());
    const renderer = (city as unknown as { instancedRenderer: InstancedBuildingRenderer })
      .instancedRenderer;
    let updates = 0;
    renderer.updateWindowLighting = () => {
      updates++;
    };
    for (let i = 0; i < 60; i++) city.updateTimeOfDay(12);
    expect(updates).toBe(1);
    city.updateTimeOfDay(20, true);
    expect(updates).toBe(2);
    city.dispose();
  });
  test('window capacity grows without losing windows across a lighting transition', () => {
    const scene = new Scene();
    const renderer = new InstancedBuildingRenderer(scene);
    // 4 * 250 columns * 60 rows = 60000 windows; exceeds either initial pool.
    renderer.createBuilding(V(), 1000, 300, 1000);
    expect(renderer.getStats().totalWindows).toBe(60000);
    renderer.updateWindowLighting(21);
    expect(renderer.getStats().totalWindows).toBe(60000);
    renderer.updateWindowLighting(12);
    expect(renderer.getStats().totalWindows).toBe(60000);
    renderer.dispose();
  });
});

test('moving threat instance bounds enclose world positions and duplicate adds are idempotent', () => {
  const scene = new Scene();
  const renderer = new InstancedThreatRenderer(scene, 1);
  let position = V(2500, 100);
  const threat = {
    id: 'bounds-regression',
    type: ThreatType.SHORT_RANGE,
    mesh: { visible: true, parent: null },
    getPosition: () => position,
    getVelocity: () => V(10),
  } as unknown as Threat;
  expect(renderer.addThreat(threat)).toBe(true);
  expect(renderer.addThreat(threat)).toBe(true);
  renderer.updateThreats([threat]);
  const rocket = scene.children[0] as InstancedMesh;
  expect(rocket.boundingSphere!.containsPoint(position)).toBe(true);
  position = V(-3500, 300, 1500);
  renderer.updateThreats([threat]);
  expect(rocket.boundingSphere!.containsPoint(position)).toBe(true);
  renderer.removeThreat(threat.id);
  const matrix = new Matrix4();
  rocket.getMatrixAt(0, matrix);
  expect(new Vector3().setFromMatrixScale(matrix).length()).toBe(0);
  expect(renderer.addThreat(threat)).toBe(true);
  renderer.dispose();
});

test('trail count, buffer budget, dirty uploads and final removal remain bounded', () => {
  simulationClock.reset();
  const scene = new Scene();
  const trails = PooledTrailSystem.getInstance(scene);
  const ids: string[] = [];
  for (let i = 0; i < 501; i++) {
    const id = trails.createTrail(50);
    if (id) ids.push(id);
  }
  expect(ids).toHaveLength(500);
  for (const id of ids) for (let i = 0; i < 50; i++) trails.updateTrail(id, V(i));
  trails.update();
  const geometry = (trails as unknown as { geometry: import('three').BufferGeometry }).geometry;
  expect(geometry.drawRange.count).toBe(49000);
  const attribute = geometry.getAttribute('position') as BufferAttribute;
  const version = attribute.version;
  trails.update();
  expect(attribute.version).toBe(version);
  for (const id of ids) trails.removeTrail(id);
  trails.update();
  expect(geometry.drawRange.count).toBe(0);
  expect(trails.getStats().reservedVertices).toBe(0);
  const large: string[] = [];
  for (let i = 0; i < 100; i++) {
    const id = trails.createTrail(300);
    if (id) large.push(id);
  }
  expect(large).toHaveLength(Math.floor(50000 / 598));
  for (const id of large) trails.removeTrail(id);
  trails.update();
});
