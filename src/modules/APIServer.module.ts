import express, { Application } from 'express';
import { User } from 'interfaces/User.interface';
import { join } from 'path';
import Users from './Users.module';
import paths, { Paths } from '../utils/paths';
import { constants } from 'fs';
import fs from 'fs/promises';
import { json as parseJSON } from 'body-parser';
import FlightPlan from './FlightPlan.module';
import { FlightPlanWaypoint } from '../enums/FlightPlanWaypoint.enum';

export default class APIServer {
    constructor(private app: Application, private clients: Users) {}

    public init() {
        this.app.use(parseJSON());

        this.app.post('/api/token/check', (req, res) => {
            const { token } = req.body;

            const isValid: boolean = token === 'test';

            if (isValid) {
                res.status(200).json({ status: true });
            } else {
                res.status(400).json({ status: false });
            }
        });

        this.app.get('/api/users', (_, res) => {
            const users = this.clients.getUsers();

            res.json(
                Object.values(users).map((user: User) => ({
                    id: user.id,
                    ip: user.socket.handshake.address,
                    isSuperUser: user.permissions.isSuperUser,
                    canPilotingPitch: user.permissions.canPilotingPitch,
                    canPilotingRoll: user.permissions.canPilotingRoll,
                    canPilotingThrottle: user.permissions.canPilotingThrottle,
                    canMoveCamera: user.permissions.canMoveCamera,
                    canUseAutonomy: user.permissions.canUseAutonomy,
                })),
            );
        });

        this.app.get('/api/user/:id/permissions', (req, res) => {
            const socketId = req.params.id;

            const permissions = this.clients.getPermissions(socketId);

            if (!permissions) return res.sendStatus(404);

            res.json(permissions);
        });

        this.app.get('/api/user/:id/permission/:key/set/:value', (req, res) => {
            const socketId = req.params.id;

            if (!this.clients.exists(socketId)) return res.sendStatus(404);

            const { key, value } = req.params;

            const isEnabled: boolean = value == '1';

            this.clients.setPermission(socketId, key, isEnabled);

            const peer = this.clients.getPeer(socketId);

            peer.send(
                JSON.stringify({
                    action: 'permission',
                    data: {
                        [key]: isEnabled,
                    },
                }),
            );

            res.json(this.clients.getPermissions(socketId));
        });

        this.app.get('/api/flightplans', async (_, res) => {
            try {
                const files = await fs.readdir(paths[Paths.FLIGHT_PLANS]);
                const flightplans = files.filter((f) => f.endsWith('.mavlink')).map((f) => f.replace('.mavlink', ''));
                res.json(flightplans);
            } catch (err) {
                res.status(500).send(err.message);
            }
        });

        this.app.post('/api/flightplans/save', async (req, res) => {
            const { name, waypoints } = req.body;

            if (!name || !waypoints || !Array.isArray(waypoints)) {
                return res.status(400).send('Invalid data');
            }

            const fp = new FlightPlan(name);
            for (const wp of waypoints) {
                fp.addWaypoint(wp.type, { latitude: wp.lat, longitude: wp.lon }, wp.params || [0, 0, 0, 0], wp.alt);
            }

            const mavlinkContent = fp.generateMavlink();
            const filePath = join(paths[Paths.FLIGHT_PLANS], `${name}.mavlink`);

            try {
                await fs.writeFile(filePath, mavlinkContent);
                res.json({ status: 'success', path: filePath });
            } catch (err) {
                res.status(500).send(err.message);
            }
        });

        this.app.get('/flightplans/:name', async (req, res) => {
            const { name } = req.params;

            const flightPlanName: string = name + '.mavlink';

            const flightPlanPath: string = join(paths[Paths.FLIGHT_PLANS], flightPlanName);

            try {
                await fs.access(flightPlanPath, constants.F_OK);
            } catch {
                return res.sendStatus(404);
            }

            const file: string = await fs.readFile(flightPlanPath, 'utf-8');
            const lines = file
                .split(/\r?\n/g)
                .slice(1)
                .filter(Boolean)
                .map((line) => line.split(/\t/g));

            const waypoints = lines.map((o) => ({
                index: Number(o[0]),
                type: Number(o[3]),
                lat: Number(o[8]),
                lon: Number(o[9]),
                alt: Number(o[10]),
                params: [Number(o[4]), Number(o[5]), Number(o[6]), Number(o[7])],
            }));

            res.json({
                name,
                waypoints,
            });
        });

        this.app.use(express.static(join(__dirname, '../../public')));

        this.app.use((_, res) => res.sendStatus(404));
    }
}
