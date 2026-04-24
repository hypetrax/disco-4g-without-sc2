import { FlightPlanWaypoint } from '../enums/FlightPlanWaypoint.enum';

interface Waypoint {
    index: number;
    type: FlightPlanWaypoint;
    latitude: number;
    longitude: number;
    altitude: number;
    params: number[];
}

export default class FlightPlan {
    private waypoints: Waypoint[] = [];

    constructor(private readonly name: string = 'plan') {
        // Add default start waypoint (required for some Parrot versions)
        this.addWaypoint(FlightPlanWaypoint.START, { latitude: 0, longitude: 0 }, [2073600, 0, 0, 0], 30);
    }

    public getName(): string {
        return this.name;
    }

    public addWaypoint(
        type: FlightPlanWaypoint,
        location: { latitude: number; longitude: number },
        params: number[] = [0, 0, 0, 0],
        altitude: number = 50,
    ): number {
        const index = this.waypoints.length;
        this.waypoints.push({
            index,
            type,
            latitude: location.latitude,
            longitude: location.longitude,
            altitude,
            params,
        });
        return index;
    }

    public deleteWaypoint(index: number): boolean {
        if (index < 0 || index >= this.waypoints.length) return false;
        this.waypoints.splice(index, 1);
        this.reindex();
        return true;
    }

    public moveWaypoint(index: number, location: { latitude: number; longitude: number }): boolean {
        if (index < 0 || index >= this.waypoints.length) return false;
        this.waypoints[index].latitude = location.latitude;
        this.waypoints[index].longitude = location.longitude;
        return true;
    }

    public setAltitude(index: number, altitude: number): boolean {
        if (index < 0 || index >= this.waypoints.length) return false;
        this.waypoints[index].altitude = altitude;
        return true;
    }

    private reindex() {
        this.waypoints.forEach((wp, i) => (wp.index = i));
    }

    public generateMavlink(): string {
        let output = 'QGC WPL 120\n';
        this.waypoints.forEach((wp) => {
            const line = [
                wp.index,
                wp.index === 0 ? 1 : 0, // Current WP (1 for first, 0 for others)
                3, // Coord Frame: MAV_FRAME_GLOBAL_RELATIVE_ALT
                wp.type,
                wp.params[0].toFixed(6),
                wp.params[1].toFixed(6),
                wp.params[2].toFixed(6),
                wp.params[3].toFixed(6),
                wp.latitude.toFixed(6),
                wp.longitude.toFixed(6),
                wp.altitude.toFixed(6),
                1, // Autocontinue
            ].join('\t');
            output += line + '\n';
        });
        return output;
    }
}
