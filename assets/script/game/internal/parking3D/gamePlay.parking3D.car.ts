import { _decorator, BoxCollider, Component, Game, ITriggerEvent, math, Node, ParticleSystem, tween, Vec2, Vec3 } from "cc";
import { GamePlayParking3DRoad } from "./gamePlay.parking3D.road";
import { PlayableManagerConfig } from "../../../framework/runtime/playable.manager.config";
import { GamePlayParking3DEntity } from "./gamePlay.parking3D.entity";
import { EEntityDirection } from "../../../framework/internal/entity/playable.entity";
import { GamePlayParking3DUtility } from "./gamePlay.parking3D.utility";
import { GamePlayParking3DObstacle } from "./gamePlay.parking3D.obstacle";
import { GamePlayParking3DLiftingRod } from "./gamePlay.parking3D.liftingRod";
import { PlayableManagerEvent } from "../../../framework/runtime/playable.manager.message";
import { PlayableManagerScene } from "../../../framework/runtime/playable.manager.scene";
import { GamePlayParking3DLevel } from "./gamePlay.parking3D.level";
const { ccclass, property } = _decorator;

export enum ECarStatus
{
    Idle,
    Willing,
    Driving,
}

@ccclass('GamePlayParking3DCar')
export class GamePlayParking3DCar extends GamePlayParking3DEntity
{
    @property(Node)
    public Dust: Node;

    @property(Node)
    public Hit: Node;

    private _status: ECarStatus = ECarStatus.Idle;
    private _isCollision; boolean = false;

    public get Status(): ECarStatus
    {
        return this._status;
    }
    public set Status(value: ECarStatus)
    {
        this._status = value;
    }

    public override move(delta: Vec2)
    {
        if (this._status !== ECarStatus.Idle)
        {
            return;
        }

        switch (this.headDir)
        {
            case EEntityDirection.Up:
            case EEntityDirection.Down:
                {
                    this.movingDir = delta.y > 0 ? EEntityDirection.Up : EEntityDirection.Down;
                }
                break
            case EEntityDirection.Left:
            case EEntityDirection.Right:
                {
                    this.movingDir = delta.x > 0 ? EEntityDirection.Right : EEntityDirection.Left;
                }
                break
        }
        this._status = ECarStatus.Willing;
    }

    /**
     * 撞击后重置位置
     * @param entity 撞击到的物体
     */
    public override hit(entity: GamePlayParking3DEntity)
    {
        super.hit(entity);

        const pos = this.node.getPosition();
        const hitPos = entity.node.getPosition();
        const size = this.ColliderSize;
        const hitSize = entity.ColliderSize;
        const rest_gap = PlayableManagerConfig.getInstance().settings.json.parking3D.rest_gap;
        switch (this.movingDir)
        {
            case EEntityDirection.Up:
                pos.z = hitPos.add(hitSize).add(size).z + rest_gap;
                break
            case EEntityDirection.Down:
                pos.z = hitPos.subtract(hitSize).subtract(size).z - rest_gap;
                break
            case EEntityDirection.Left:
                pos.x = hitPos.add(hitSize).add(size).x + rest_gap;
                break
            case EEntityDirection.Right:
                pos.x = hitPos.subtract(hitSize).subtract(size).x - rest_gap;
                break
        }
        this.node.setPosition(pos.x, pos.y, pos.z)
    }

    protected override onLoad()
    {
        super.onLoad();

        this.Status = ECarStatus.Idle;
        this.Dust.active = false;
    }

    protected override lateUpdate(dt: number): void
    {
        this._isCollision = false;
    }

    protected override updateMovement(dt: number): void
    {
        if (this._status == ECarStatus.Willing)
        {
            const distance = PlayableManagerConfig.getInstance().settings.json.parking3D.max_speed * dt;
            const pos = this.node.getPosition()
            switch (this.movingDir)
            {
                case EEntityDirection.Up:
                    pos.z -= distance
                    break
                case EEntityDirection.Down:
                    pos.z += distance
                    break
                case EEntityDirection.Left:
                    pos.x -= distance
                    break
                case EEntityDirection.Right:
                    pos.x += distance
                    break
            }

            this.node.setPosition(pos.x, pos.y, pos.z)
        }
    }

    protected override async onTriggerEnter(event: ITriggerEvent): Promise<void>
    {
        super.onTriggerEnter(event);

        if (this._isCollision)
        {
            return;
        }
        this._isCollision = true;
        const other: Node = event.otherCollider.node;

        // 撞到障碍物
        const obstacle = other.getComponent(GamePlayParking3DObstacle)
        if (obstacle)
        {
            this.hit(obstacle);
            this._status = ECarStatus.Idle;
            return;
        }

        // 撞到车
        const car = other.getComponent(GamePlayParking3DCar)
        if (car)
        {
            switch (this._status)
            {
                case ECarStatus.Idle:
                    this.onHit(car);
                    break;

                case ECarStatus.Willing:
                    switch (car.Status)
                    {
                        case ECarStatus.Idle:
                            this.hit(car);
                            this._status = ECarStatus.Idle;

                            if (this.headDir == this.movingDir)
                            {
                                this.Hit.children.map(c => c.getComponent(ParticleSystem).play())
                            }
                            break;
                        case ECarStatus.Willing:
                            GamePlayParking3DUtility.collided(car, this);
                            this._status = ECarStatus.Idle;
                            car._status = ECarStatus.Idle;
                            car._isCollision = true
                            break;
                    }
            }

            return;
        }

        // 接触到道路
        if (this._status != ECarStatus.Driving)
        {
            const road = other.getComponent(GamePlayParking3DRoad);
            if (road)
            {
                this._status = ECarStatus.Driving;
                this.Dust.active = true;
    
                // 靠近道路
                const start = road.getSidePoint(this.node.getPosition())
                await this.movingLine(start);
    
                // 进入道路
                const radius = road.getCornerRadius();
                if (this.headDir === this.movingDir)
                {
                    await this.movingForwardCorner(radius);
                }
                else
                {
                    await this.movingBackingCorner(radius);
                }
    
                // 完成路线
                const sequence = (PlayableManagerScene.getInstance().CurrentGamePlay as GamePlayParking3DLevel).SequenceRoads;
                const run = async (road: GamePlayParking3DRoad) => 
                {
                    const end = road.getEndPoint();
                    await this.movingLine(end);
                    await this.movingForwardCorner(radius)
                }
                let check: boolean = false;
                for (const r of sequence)
                {
                    if (check)
                    {
                        await run(r);
                        continue;
                    }
                    if (road.node === r.node)
                    {
                        check = true;
                        await run(r);
                    }
                }
            }
        }

        // 撞到抬杆
        const liftingRod: GamePlayParking3DLiftingRod = other.getComponent(GamePlayParking3DLiftingRod)
        if (liftingRod)
        {
            PlayableManagerEvent.getInstance().emit("onCarLeaving", this);
        }
    }

    private async movingLine(target: Vec3, isFacing: boolean = false): Promise<void>
    {
        return new Promise<void>((resolve, reject) =>
        {
            const pos = this.node.getPosition();
            const posV2 = new Vec2(pos.x, pos.z);
            const tgtV2 = new Vec2(target.x, target.z);
            const dirV2 = tgtV2.subtract(posV2);
            const angle = -math.toDegree(math.Vec2.UNIT_X.signAngle(dirV2));
            const time = dirV2.length() / PlayableManagerConfig.getInstance().settings.json.parking3D.max_speed;
            const euler = this.node.eulerAngles;
            if (isFacing)
            {
                this.node.eulerAngles = math.v3(euler.x, angle, euler.z)
            }
            tween(this.node).to(time,
                {
                    position: math.v3(target.x, pos.y, target.z)
                })
                .call(() =>
                {
                    resolve()
                })
                .start()
        })
    }


    private async movingForwardCorner(radius: number): Promise<void>
    {
        return new Promise<void>((resolve, reject) =>
        {
            if (radius <= 0)
            {
                resolve();
            }

            const time = radius * math.HALF_PI / PlayableManagerConfig.getInstance().settings.json.parking3D.max_speed;
            const angle = this.node.eulerAngles
            switch (this.movingDir)
            {
                case EEntityDirection.Left:
                    {
                        const pos = this.node.getPosition().clone()
                        const basePos = pos.add(math.v3(0, 0, -radius))
                        this.node.eulerAngles = math.v3(angle.x, 180, angle.z)
                        tween(this.node.eulerAngles).to(time, math.v3(angle.x, 90, angle.z),
                            {
                                onUpdate: (target: math.Vec3, ratio: number) =>
                                {
                                    this.node.eulerAngles = target
                                    this.node.position = math.v3(basePos.x - radius * Math.sin(math.toRadian(target.y)), basePos.y, basePos.z - radius * Math.cos(math.toRadian(target.y)));
                                }
                            })
                            .call(() =>
                            {
                                this.movingDir = EEntityDirection.Up;
                                resolve();
                            })
                            .start();
                    }
                    break
                case EEntityDirection.Right:
                    {
                        const pos = this.node.getPosition().clone()
                        const basePos = pos.add(math.v3(0, 0, radius))
                        this.node.eulerAngles = math.v3(angle.x, 0, angle.z)
                        tween(this.node.eulerAngles).to(time, math.v3(angle.x, -90, angle.z),
                            {
                                onUpdate: (target: math.Vec3, ratio: number) =>
                                {
                                    this.node.eulerAngles = target
                                    this.node.position = math.v3(basePos.x - radius * Math.sin(math.toRadian(target.y)), basePos.y, basePos.z - radius * Math.cos(math.toRadian(target.y)));
                                }
                            })
                            .call(() =>
                            {
                                this.movingDir = EEntityDirection.Down;
                                resolve();
                            })
                            .start()
                    }
                    break
                case EEntityDirection.Down:
                    {
                        const pos = this.node.getPosition().clone()
                        const basePos = pos.add(math.v3(-radius, 0, 0))
                        this.node.eulerAngles = math.v3(angle.x, -90, angle.z)
                        tween(this.node.eulerAngles).to(time, math.v3(angle.x, -180, angle.z),
                            {
                                onUpdate: (target: math.Vec3, ratio: number) =>
                                {
                                    this.node.eulerAngles = target
                                    this.node.position = math.v3(basePos.x - radius * Math.sin(math.toRadian(target.y)), basePos.y, basePos.z - radius * Math.cos(math.toRadian(target.y)));
                                }
                            })
                            .call(() =>
                            {
                                this.movingDir = EEntityDirection.Left;
                                resolve();
                            })
                            .start()
                    }
                    break
                case EEntityDirection.Up:
                    {
                        const pos = this.node.getPosition().clone()
                        const basePos = pos.add(math.v3(radius, 0, 0))
                        this.node.eulerAngles = math.v3(angle.x, 90, angle.z)
                        tween(this.node.eulerAngles).to(time, math.v3(angle.x, 0, angle.z),
                            {
                                onUpdate: (target: math.Vec3, ratio: number) =>
                                {
                                    this.node.eulerAngles = target
                                    this.node.position = math.v3(basePos.x - radius * Math.sin(math.toRadian(target.y)), basePos.y, basePos.z - radius * Math.cos(math.toRadian(target.y)))
                                }
                            })
                            .call(() =>
                            {
                                this.movingDir = EEntityDirection.Right;
                                resolve();
                            })
                            .start()
                    }
                    break
            }
        })
    }

    private movingBackingCorner(radius: number): Promise<void>
    {
        return new Promise<void>((resolve, reject) =>
        {
            if (radius <= 0)
            {
                resolve();
            }

            const dt = radius * math.HALF_PI / PlayableManagerConfig.getInstance().settings.json.parking3D.max_speed;
            const angle = this.node.eulerAngles
            const pos = this.node.getPosition().clone()
            switch (this.movingDir)
            {
                case EEntityDirection.Left:
                    {
                        const pos = this.node.getPosition().clone()
                        const basePos = pos.add(math.v3(0, 0, radius))
                        this.node.eulerAngles = math.v3(angle.x, 0, angle.z)
                        tween(this.node.eulerAngles).to(dt, math.v3(angle.x, 90, angle.z),
                            {
                                onUpdate: (target: math.Vec3, ratio: number) =>
                                {
                                    this.node.eulerAngles = target
                                    this.node.position = math.v3(basePos.x - radius * Math.sin(math.toRadian(target.y)), basePos.y, basePos.z - radius * Math.cos(math.toRadian(target.y)))
                                }
                            })
                            .call(() =>
                            {
                                this.movingDir = EEntityDirection.Up;
                                resolve();
                            })
                            .start()
                    }
                    break
                case EEntityDirection.Right:
                    {
                        const pos = this.node.getPosition().clone()
                        const basePos = pos.add(math.v3(0, 0, -radius))
                        this.node.eulerAngles = math.v3(angle.x, 180, angle.z)
                        tween(this.node.eulerAngles).to(dt, math.v3(angle.x, 270, angle.z),
                            {
                                onUpdate: (target: math.Vec3, ratio: number) =>
                                {
                                    this.node.eulerAngles = target
                                    this.node.position = math.v3(basePos.x - radius * Math.sin(math.toRadian(target.y)), basePos.y, basePos.z - radius * Math.cos(math.toRadian(target.y)))
                                }
                            }).call(() =>
                            {
                                this.movingDir = EEntityDirection.Down;
                                resolve();
                            }).start()
                    }
                    break
                case EEntityDirection.Down:
                    {
                        const pos = this.node.getPosition().clone()
                        const basePos = pos.add(math.v3(radius, 0, 0))
                        this.node.eulerAngles = math.v3(angle.x, 90, angle.z)
                        tween(this.node.eulerAngles).to(dt, math.v3(angle.x, 180, angle.z),
                            {
                                onUpdate: (target: math.Vec3, ratio: number) =>
                                {
                                    this.node.eulerAngles = target
                                    this.node.position = math.v3(basePos.x - radius * Math.sin(math.toRadian(target.y)), basePos.y, basePos.z - radius * Math.cos(math.toRadian(target.y)))
                                }
                            }).call(() =>
                            {
                                this.movingDir = EEntityDirection.Left;
                                resolve();
                            }).start()
                    }
                    break
                case EEntityDirection.Up:
                    {
                        const pos = this.node.getPosition().clone()
                        const basePos = pos.add(math.v3(-radius, 0, 0))
                        this.node.eulerAngles = math.v3(angle.x, -90, angle.z)
                        tween(this.node.eulerAngles).to(dt, math.v3(angle.x, 0, angle.z),
                            {
                                onUpdate: (target: math.Vec3, ratio: number) =>
                                {
                                    this.node.eulerAngles = target
                                    this.node.position = math.v3(basePos.x - radius * Math.sin(math.toRadian(target.y)), basePos.y, basePos.z - radius * Math.cos(math.toRadian(target.y)))
                                }
                            }).call(() =>
                            {
                                this.movingDir = EEntityDirection.Right;
                                resolve();
                            }).start()
                    }
                    break
            }
        })
    }
}