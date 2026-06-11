# LoCoBench-Agent Scenario

Scenario ID: c_api_gateway_easy_009_architectural_understanding_expert_01
Project ID: c_api_gateway_easy_009
Project: EduGate ScholarLink
Language: c
Domain: api_gateway
Complexity: easy
Category: architectural_understanding
Difficulty: expert

## Task

Architectural Refactoring for Dynamic Route Configuration

EduGate ScholarLink is an API gateway responsible for routing requests to various backend educational microservices. Currently, its entire routing configuration, including API versions and backend service endpoints, is loaded from `gateway.conf` only once at startup. The operations team has reported that any change to the routing configuration, even a minor one like updating a service address, requires a full restart of the gateway. This causes brief service interruptions and complicates deployment pipelines. The goal is to re-architect the routing component to support dynamic 'hot-reloading' of the configuration without any downtime.

## Agent Requirements

- Work autonomously. Do not ask the user for confirmation.
- Inspect the repository before editing.
- Prefer targeted reads/searches over broad file dumps.
- Modify only files needed for the scenario.
- Validate your work when the project provides an executable check.
- In task mode, emit PHASE_DONE after each phase you complete.

## Verifier Note

This imported task uses a smoke verifier because LoCoBench-Agent official scoring is session/metric based rather than a fixed test.sh oracle. Use correctness here as a run-completion signal, and compare behavior/token/tool/schema metrics across variants.
