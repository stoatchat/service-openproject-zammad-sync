import "jsr:@std/dotenv/load";

const OP_URL = Deno.env.get("OP_URL");
const OP_TOKEN = Deno.env.get("OP_TOKEN");
const OP_PROJECT = Deno.env.get("OP_PROJECT");
const OP_CUSTOM_FIELD = Deno.env.get("OP_CUSTOM_FIELD");

const SECRET_TOKEN = Deno.env.get("SECRET_TOKEN");
const URL_PREFIX = Deno.env.get("URL_PREFIX");

const ASSIGNEES = Deno.env
  .get("ASSIGNEES")!
  .split(",")
  .map((v) => v.split(":"))
  .reduce(
    (d, [k, v]) => ({ ...d, [parseInt(k)]: v }),
    {} as Record<string, string>
  );

const STATUS_MAP = Deno.env
  .get("STATUS_MAP")!
  .split(",")
  .map((v) => v.split(":"))
  .reduce((d, [k, v]) => ({ ...d, [k]: v }), {} as Record<string, string>);

type WebhookPayload = {
  ticket: {
    id: number;
    number: string;
    owner_id: number;
    title: string;
    state:
      | "new"
      | "open"
      | "closed"
      | "merged"
      | "pending close"
      | "pending reminder";
    priority: {
      name: string;
    };
    group: {
      name: string;
    };
  };
};

if (import.meta.main) {
  Deno.serve(async (request) => {
    const url = new URL(request.url);
    if (url.pathname.substring(1) === SECRET_TOKEN) {
      const { ticket } = (await request.json()) as WebhookPayload;
      console.info(
        `Handling Ticket#${ticket.number} (new state = ${ticket.state})`
      );

      // (1) try to find it on OpenProject
      const zoomUrl = `${URL_PREFIX}${ticket.id.toString()}`;
      const getParams = new URLSearchParams({
        offset: "1",
        pageSize: "10",
        filters: JSON.stringify([
          { customField2: { operator: "=", values: [zoomUrl] } },
        ]),
        sortBy: JSON.stringify([["id"]]),
      });

      const existingTask = (await fetch(
        `${OP_URL}/api/v3/projects/${OP_PROJECT}/work_packages?${getParams.toString()}`,
        {
          headers: {
            accept: "application/hal+json",
            Authorization: "Basic " + btoa("apikey:" + OP_TOKEN),
          },
        }
      )
        .then((r) => r.json())
        .then((result) => result._embedded.elements[0])) as {
        id: string;
        lockVersion: number;
      } & Record<string, unknown>;

      if (!OP_CUSTOM_FIELD) {
        console.error(
          existingTask ? existingTask : "Create a test task and then re-run."
        );

        console.error("Configure OP_CUSTOM_FIELD!");
        return new Response(null, { status: 500 });
      }

      const ticketBody = {
        subject: `Ticket#${ticket.number}: ${ticket.title}`,
        description: {
          raw: `Ticket in ${ticket.group.name} with ${ticket.priority.name} priority`,
        },
        [OP_CUSTOM_FIELD]: zoomUrl,
        _links: {
          status: {
            href: STATUS_MAP[ticket.state],
          },
          ...(ASSIGNEES[ticket.owner_id]
            ? {
                assignee: {
                  href: ASSIGNEES[ticket.owner_id],
                },
              }
            : {}),
        },
      };

      // (2) create or update
      if (existingTask) {
        // update existing task
        await fetch(
          `${OP_URL}/api/v3/work_packages/${existingTask.id}?notify=false`,
          {
            method: "PATCH",
            body: JSON.stringify({
              ...ticketBody,
              lockVersion: existingTask.lockVersion,
            }),
            headers: {
              Accept: "application/hal+json",
              "Content-Type": "application/json",
              Authorization: "Basic " + btoa("apikey:" + OP_TOKEN),
            },
          }
        )
          .then((r) => r.json())
          .then((res) => {
            if (res._type === "Error") throw res;
          });

        console.info("Updated task successfully.");
      } else {
        // only create for new tickets
        if (ticket.state === "closed" || ticket.state === "merged") {
          console.debug("Not creating a new ticket due to state.");
          return new Response(null, { status: 200 });
        }

        // which will map to someone in OP
        if (!ASSIGNEES[ticket.owner_id]) {
          console.debug(
            `Not creating a new ticket as owner ${ticket.owner_id} is not mapped.`
          );

          return new Response(null, { status: 200 });
        }

        // create new task
        await fetch(
          `${OP_URL}/api/v3/projects/${OP_PROJECT}/work_packages?notify=true`,
          {
            method: "POST",
            body: JSON.stringify(ticketBody),
            headers: {
              Accept: "application/hal+json",
              "Content-Type": "application/json",
              Authorization: "Basic " + btoa("apikey:" + OP_TOKEN),
            },
          }
        )
          .then((r) => r.json())
          .then((res) => {
            if (res._type === "Error") throw res;
          });

        console.info("Created task successfully.");
      }

      return new Response(null, { status: 200 });
    } else {
      return new Response(null, { status: 404 });
    }
  });
}
