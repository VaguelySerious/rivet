import { expect, type TestContext, test } from "vitest";
import { CONN_DRAIN_DISCONNECT_MARKER } from "../../fixtures/driver-test-suite/conn-drain";
import type { registry } from "../../fixtures/driver-test-suite/registry-static";
import { createClient } from "@/client/mod";
import type { ActorError } from "@/client/errors";
import { describeDriverMatrix } from "./shared-matrix";

describeDriverMatrix(
	"Connection Drain",
	(driverTestConfig) => {
		async function startDrainingRuntime(c: TestContext) {
			const runtime = await driverTestConfig.start({
				env: { RIVETKIT_TEST_DRAIN_ON_SIGTERM: "1" },
			});
			const client = createClient<typeof registry>({
				endpoint: runtime.endpoint,
				namespace: runtime.namespace,
				poolName: runtime.runnerName,
				encoding: driverTestConfig.encoding,
				disableMetadataLookup: true,
			});
			c.onTestFinished(async () => {
				await client.dispose();
				await runtime.cleanup();
			});
			return { runtime, client };
		}

		test("closes connections with ws.going_away and runs onDisconnect once", async (c) => {
			const { runtime, client } = await startDrainingRuntime(c);
			const key = crypto.randomUUID();
			const conn = client.connDrainActor.getOrCreate([key]).connect();
			const errors: ActorError[] = [];
			conn.onError((error) => errors.push(error));
			const closed = new Promise<void>((resolve) =>
				conn.onClose(resolve),
			);
			expect(await conn.ping()).toBe("pong");

			await runtime.cleanup();
			await closed;

			expect(
				errors.map((error) => `${error.group}.${error.code}`),
			).toEqual(["ws.going_away"]);
			const output = runtime.getRuntimeOutput?.() ?? "";
			const hookRuns =
				output.split(`${CONN_DRAIN_DISCONNECT_MARKER} ${key}`).length -
				1;
			expect(hookRuns).toBe(1);
		});

		test("delivers an in-flight action result before disconnecting", async (c) => {
			const { runtime, client } = await startDrainingRuntime(c);
			const conn = client.connDrainActor
				.getOrCreate([crypto.randomUUID()])
				.connect();
			const started = new Promise<void>((resolve) =>
				conn.once("workStarted", () => resolve()),
			);

			const result = conn.work();
			await started;
			await runtime.cleanup();

			expect(await result).toBe("done");
		});
	},
	{
		encodings: ["bare"],
		runtimes: ["native"],
		sqliteBackends: ["local"],
	},
);
