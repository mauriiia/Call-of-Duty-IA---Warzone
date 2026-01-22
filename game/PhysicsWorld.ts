import * as CANNON from 'cannon-es';
import { CONFIG, PHYSICS_MATERIALS } from '../constants';

export class PhysicsWorld {
  public world: CANNON.World;
  private materials: Record<string, CANNON.Material>;

  constructor() {
    this.world = new CANNON.World();
    this.world.gravity.set(0, CONFIG.gravity, 0);

    // OTIMIZAÇÃO CRÍTICA 1: SAPBroadphase (Sweep And Prune)
    // Muito mais rápido que NaiveBroadphase para jogos com muitos objetos espalhados.
    // Ele ordena os objetos nos eixos e só testa quem está perto.
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    
    // OTIMIZAÇÃO CRÍTICA 2: Permitir Sleep
    // Objetos parados param de ser calculados pela CPU.
    this.world.allowSleep = true; 
    
    // Ajuste fino para o Sleep não ser agressivo demais (só dorme se ficar muito quieto)
    this.world.defaultContactMaterial.contactEquationStiffness = 1e8;
    this.world.defaultContactMaterial.contactEquationRelaxation = 3;

    // PERFORMANCE: Iterações do Solver
    // 5 é geralmente suficiente para shooters arcade. Se notar objetos atravessando o chão, suba para 7.
    (this.world.solver as CANNON.GSSolver).iterations = 5; 
    
    // Setup Materials
    this.materials = {
      ground: new CANNON.Material('ground'),
      player: new CANNON.Material('player'),
      object: new CANNON.Material('object')
    };

    // 1. Player vs Ground: FRICTIONLESS (Para andar suave sem prender no chão)
    const groundPlayerCM = new CANNON.ContactMaterial(
      this.materials.ground,
      this.materials.player,
      { friction: 0.0, restitution: 0.0 }
    );
    
    // 2. Player vs Objects: FRICTIONLESS (Não grudar em paredes)
    const playerObjectCM = new CANNON.ContactMaterial(
        this.materials.player,
        this.materials.object,
        { friction: 0.0, restitution: 0.0 }
    );

    // 3. Ground vs Objects: Atrito normal (Para caixas não deslizarem como gelo)
    const groundObjectCM = new CANNON.ContactMaterial(
        this.materials.ground,
        this.materials.object,
        { friction: 0.5, restitution: 0.1 } // Valores hardcoded para garantir estabilidade
    );

    this.world.addContactMaterial(groundPlayerCM);
    this.world.addContactMaterial(playerObjectCM);
    this.world.addContactMaterial(groundObjectCM);
  }

  public step(dt: number) {
    // OTIMIZAÇÃO 3: Step Simples
    // Como o GameEngine.ts já garante que o 'dt' é fixo (1/60),
    // não precisamos pedir para o Cannon interpolar de novo.
    // Usamos o método simples que é mais leve.
    this.world.step(dt);
  }

  public getMaterial(name: keyof typeof PHYSICS_MATERIALS): CANNON.Material {
    return this.materials[name];
  }
}