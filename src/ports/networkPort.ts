import type { RequestContext } from '../application/requestContext';
import type { Availability } from './indexPort';

export interface NetworkRequest {
	url: string;
	method: string;
	headers: Record<string, string>;
	body?: string;
}

export interface NetworkResponse {
	status: number;
	headers: Record<string, string>;
	body: string;
}

export interface NetworkPort {
	request(input: NetworkRequest, context: RequestContext): Promise<NetworkResponse>;
	availability(): Availability;
}
