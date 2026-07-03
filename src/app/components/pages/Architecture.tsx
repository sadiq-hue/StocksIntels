import { useState } from "react";
import { ChevronRight, Clock, Database, Server, Zap, AlertCircle, CheckCircle, XCircle } from "lucide-react";
import { motion } from "motion/react";

type DiagramView = "topology" | "message-flow" | "payment-pipeline";

const topologyNodes = {
  external: [
    { id: "whatsapp", name: "WhatsApp Cloud API", type: "Managed Service", cost: "$0.005/msg" },
    { id: "smtp", name: "SMTP Provider", type: "SendGrid/Postmark", cost: "$10/mo" },
  ],
  core: [
    { id: "gateway", name: "API Gateway", type: "Fastify on Railway", cost: "$5/mo", latency: "~50ms" },
    { id: "ai-service", name: "AI Service", type: "Node.js + OpenAI", cost: "$20/mo", latency: "~1.5s" },
    { id: "booking", name: "Booking Service", type: "Node.js", cost: "$5/mo", latency: "~200ms" },
    { id: "payment", name: "Payment Service", type: "Node.js", cost: "$5/mo", latency: "~300ms" },
    { id: "postgres", name: "PostgreSQL", type: "Supabase", cost: "$25/mo" },
    { id: "redis", name: "Redis Cache", type: "Upstash", cost: "$10/mo" },
    { id: "queue", name: "Job Queue", type: "BullMQ", cost: "Included" },
  ],
  integrations: [
    { id: "mpesa", name: "M-Pesa API", type: "Safaricom", cost: "2.5% fee" },
    { id: "calendar", name: "Calendar API", type: "Google Calendar", cost: "Free" },
    { id: "crm", name: "CRM Sync", type: "Optional", cost: "$0" },
  ],
};

const messageFlowSteps = [
  { id: 1, name: "WhatsApp Message", component: "WhatsApp Cloud API", time: "0ms", detail: "Customer sends message" },
  { id: 2, name: "Webhook Received", component: "API Gateway", time: "+20ms", detail: "Message routed to AI service" },
  { id: 3, name: "Context Lookup", component: "Redis Cache", time: "+50ms", detail: "Load conversation history" },
  { id: 4, name: "AI Processing", component: "OpenAI GPT-4", time: "+1500ms", detail: "Generate response based on context" },
  { id: 5, name: "Intent Detection", component: "AI Service", time: "+50ms", detail: "Detect booking intent" },
  { id: 6, name: "Check Availability", component: "Booking Service", time: "+100ms", detail: "Query calendar slots" },
  { id: 7, name: "Store State", component: "PostgreSQL", time: "+150ms", detail: "Save conversation + booking" },
  { id: 8, name: "Send Response", component: "WhatsApp Cloud API", time: "+80ms", detail: "Reply to customer" },
];

const paymentStates = [
  { id: "won", name: "Deal Won", status: "trigger", detail: "Sales team marks deal as won" },
  { id: "request", name: "Payment Request", status: "processing", detail: "Generate M-Pesa STK push" },
  { id: "pending", name: "Awaiting Callback", status: "waiting", detail: "Customer confirms on phone" },
  { id: "confirmed", name: "Payment Confirmed", status: "success", detail: "M-Pesa callback received" },
  { id: "timeout", name: "Timeout / Failed", status: "error", detail: "Reconciliation needed" },
  { id: "finance", name: "Financial Record", status: "complete", detail: "Transaction logged" },
];

export function Architecture() {
  const [view, setView] = useState<DiagramView>("topology");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [animating, setAnimating] = useState(false);

  const startAnimation = () => {
    setAnimating(true);
    setTimeout(() => setAnimating(false), messageFlowSteps.length * 600);
  };

  return (
    <div className="h-full p-8 space-y-6 flex flex-col overflow-hidden">
      <div className="shrink-0">
        <h1>System Architecture</h1>
        <p className="text-muted-foreground">Interactive infrastructure visualization</p>
      </div>

      <div className="flex gap-3 shrink-0">
        <button
          onClick={() => setView("topology")}
          className={`px-4 py-2 rounded-lg transition-colors ${
            view === "topology"
              ? "bg-primary text-primary-foreground"
              : "border border-border hover:bg-accent"
          }`}
        >
          System Topology
        </button>
        <button
          onClick={() => setView("message-flow")}
          className={`px-4 py-2 rounded-lg transition-colors ${
            view === "message-flow"
              ? "bg-primary text-primary-foreground"
              : "border border-border hover:bg-accent"
          }`}
        >
          Message Flow
        </button>
        <button
          onClick={() => setView("payment-pipeline")}
          className={`px-4 py-2 rounded-lg transition-colors ${
            view === "payment-pipeline"
              ? "bg-primary text-primary-foreground"
              : "border border-border hover:bg-accent"
          }`}
        >
          Payment Pipeline
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
      {view === "topology" && (
        <div className="space-y-8">
          <div className="grid grid-cols-3 gap-6">
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
                <h3 className="text-blue-900 mb-2">External Channels</h3>
                <p className="text-sm text-blue-700">Managed services</p>
              </div>
              <div className="space-y-3">
                {topologyNodes.external.map((node) => (
                  <motion.button
                    key={node.id}
                    onClick={() => setSelectedNode(node.id)}
                    whileHover={{ scale: 1.02 }}
                    className={`w-full p-4 rounded-lg border transition-all text-left ${
                      selectedNode === node.id
                        ? "border-primary bg-primary/5 shadow-lg"
                        : "border-border bg-card hover:border-primary/50"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Server className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{node.name}</p>
                        <p className="text-sm text-muted-foreground">{node.type}</p>
                        <p className="text-xs text-green-600 mt-1">{node.cost}</p>
                      </div>
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-purple-50 border border-purple-200">
                <h3 className="text-purple-900 mb-2">Core Platform</h3>
                <p className="text-sm text-purple-700">You own and build</p>
              </div>
              <div className="space-y-3">
                {topologyNodes.core.map((node) => (
                  <motion.button
                    key={node.id}
                    onClick={() => setSelectedNode(node.id)}
                    whileHover={{ scale: 1.02 }}
                    className={`w-full p-4 rounded-lg border transition-all text-left ${
                      selectedNode === node.id
                        ? "border-primary bg-primary/5 shadow-lg"
                        : "border-border bg-card hover:border-primary/50"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Database className="w-5 h-5 text-purple-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{node.name}</p>
                        <p className="text-sm text-muted-foreground">{node.type}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <p className="text-xs text-green-600">{node.cost}</p>
                          {node.latency && (
                            <p className="text-xs text-orange-600 flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {node.latency}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>

            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-green-50 border border-green-200">
                <h3 className="text-green-900 mb-2">Integrations</h3>
                <p className="text-sm text-green-700">Third-party APIs</p>
              </div>
              <div className="space-y-3">
                {topologyNodes.integrations.map((node) => (
                  <motion.button
                    key={node.id}
                    onClick={() => setSelectedNode(node.id)}
                    whileHover={{ scale: 1.02 }}
                    className={`w-full p-4 rounded-lg border transition-all text-left ${
                      selectedNode === node.id
                        ? "border-primary bg-primary/5 shadow-lg"
                        : "border-border bg-card hover:border-primary/50"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <Zap className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{node.name}</p>
                        <p className="text-sm text-muted-foreground">{node.type}</p>
                        <p className="text-xs text-green-600 mt-1">{node.cost}</p>
                      </div>
                    </div>
                  </motion.button>
                ))}
              </div>
            </div>
          </div>

          <div className="p-6 rounded-lg bg-accent/50 border border-border">
            <h4 className="mb-3">Infrastructure Summary</h4>
            <div className="grid grid-cols-3 gap-6">
              <div>
                <p className="text-sm text-muted-foreground mb-1">Total Monthly Cost</p>
                <p className="text-2xl font-semibold">~$80</p>
                <p className="text-xs text-muted-foreground mt-1">Before transaction fees</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Hosting Strategy</p>
                <p className="font-medium">Core on Railway/AWS</p>
                <p className="text-xs text-muted-foreground mt-1">Channels & integrations are vendors</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1">Performance Target</p>
                <p className="font-medium">2.5s response time</p>
                <p className="text-xs text-muted-foreground mt-1">End-to-end WhatsApp flow</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {view === "message-flow" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between p-4 rounded-lg bg-accent/50 border border-border">
            <div>
              <p className="font-medium">Total Response Time: 2.5 seconds</p>
              <p className="text-sm text-muted-foreground">AI processing dominates latency budget (~60%)</p>
            </div>
            <button
              onClick={startAnimation}
              disabled={animating}
              className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {animating ? "Animating..." : "Replay Flow"}
            </button>
          </div>

          <div className="relative">
            {messageFlowSteps.map((step, i) => {
              const isActive = animating && i === Math.floor((Date.now() % (messageFlowSteps.length * 600)) / 600);
              const isPast = animating && i < Math.floor((Date.now() % (messageFlowSteps.length * 600)) / 600);

              return (
                <div key={step.id} className="relative">
                  <motion.div
                    initial={{ opacity: 0, x: -20 }}
                    animate={{
                      opacity: animating ? (isActive || isPast ? 1 : 0.4) : 1,
                      x: 0,
                      scale: isActive ? 1.05 : 1
                    }}
                    transition={{ duration: 0.3, delay: i * 0.1 }}
                    className={`p-4 rounded-lg border transition-all ${
                      isActive
                        ? "border-primary bg-primary/10 shadow-lg"
                        : "border-border bg-card"
                    }`}
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary text-primary-foreground flex-shrink-0">
                        {step.id}
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-1">
                          <p className="font-medium">{step.name}</p>
                          <span className="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-700 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {step.time}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mb-1">{step.component}</p>
                        <p className="text-sm">{step.detail}</p>
                      </div>
                    </div>
                  </motion.div>
                  {i < messageFlowSteps.length - 1 && (
                    <div className="flex justify-center my-2">
                      <motion.div
                        animate={{
                          opacity: animating && i <= Math.floor((Date.now() % (messageFlowSteps.length * 600)) / 600) ? [0.3, 1, 0.3] : 0.5,
                        }}
                        transition={{ duration: 0.5, repeat: animating ? Infinity : 0 }}
                      >
                        <ChevronRight className="w-5 h-5 text-muted-foreground rotate-90" />
                      </motion.div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="p-6 rounded-lg bg-orange-50 border border-orange-200">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-orange-900 mb-2">Performance Risk: LLM Call</h4>
                <p className="text-sm text-orange-800 mb-3">
                  The AI processing step (~1.5s) is your primary latency bottleneck at 60% of total time.
                </p>
                <div className="space-y-2">
                  <p className="text-sm font-medium text-orange-900">Mitigation strategies:</p>
                  <ul className="text-sm text-orange-800 space-y-1 ml-4 list-disc">
                    <li>Stream AI responses back to WhatsApp as they generate</li>
                    <li>Cache common question patterns in Redis</li>
                    <li>Fallback to scripted responses for frequent queries (pricing, availability)</li>
                    <li>Use GPT-3.5-turbo for simple questions (~400ms vs 1.5s)</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {view === "payment-pipeline" && (
        <div className="space-y-6">
          <div className="p-4 rounded-lg bg-red-50 border border-red-200">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-red-900 mb-1">Critical: M-Pesa Callback is Asynchronous</p>
                <p className="text-sm text-red-800">
                  Safaricom sends callback POST seconds or minutes later. Sometimes it doesn't arrive at all.
                  The timeout/fail path is mandatory — it will cause most support tickets if not built properly.
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-4">
              <h3 className="text-green-900">Happy Path</h3>
              {paymentStates.filter(s => !["timeout"].includes(s.id)).map((state, i, arr) => (
                <div key={state.id} className="relative">
                  <div
                    className={`p-4 rounded-lg border ${
                      state.status === "success"
                        ? "border-green-500 bg-green-50"
                        : state.status === "complete"
                        ? "border-blue-500 bg-blue-50"
                        : state.status === "waiting"
                        ? "border-yellow-500 bg-yellow-50"
                        : "border-border bg-card"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      {state.status === "success" && <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />}
                      {state.status === "waiting" && <Clock className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />}
                      {state.status === "complete" && <Database className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />}
                      {!["success", "waiting", "complete"].includes(state.status) && <Server className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-0.5" />}
                      <div>
                        <p className="font-medium">{state.name}</p>
                        <p className="text-sm text-muted-foreground">{state.detail}</p>
                      </div>
                    </div>
                  </div>
                  {i < arr.length - 1 && (
                    <div className="flex justify-center my-2">
                      <ChevronRight className="w-5 h-5 text-muted-foreground rotate-90" />
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <h3 className="text-red-900">Failure Path</h3>
              <div className="p-4 rounded-lg border border-yellow-500 bg-yellow-50">
                <div className="flex items-start gap-3">
                  <Clock className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">Awaiting Callback</p>
                    <p className="text-sm text-muted-foreground">Customer confirms on phone</p>
                  </div>
                </div>
              </div>
              <div className="flex justify-center">
                <div className="border-l-2 border-dashed border-red-400 h-8" />
              </div>
              <div className="p-4 rounded-lg border border-red-500 bg-red-50">
                <div className="flex items-start gap-3">
                  <XCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-red-900">Timeout / Failed</p>
                    <p className="text-sm text-red-800">Callback never received or explicit failure</p>
                  </div>
                </div>
              </div>
              <div className="flex justify-center">
                <ChevronRight className="w-5 h-5 text-red-400 rotate-90" />
              </div>
              <div className="p-4 rounded-lg border border-orange-500 bg-orange-50">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-orange-900">Reconciliation Engine</p>
                    <p className="text-sm text-orange-800 mb-2">Handle three states cleanly:</p>
                    <ul className="text-sm text-orange-800 space-y-1 ml-4 list-disc">
                      <li>Confirmed: Update deal + create financial record</li>
                      <li>Timed out: Alert support team + retry query</li>
                      <li>Failed: Notify customer + offer retry or alternative</li>
                    </ul>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="p-6 rounded-lg bg-accent/50 border border-border">
            <h4 className="mb-4">Technical Implementation Notes</h4>
            <div className="space-y-3 text-sm">
              <div className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                <p>
                  <span className="font-medium">Webhook security:</span> Validate M-Pesa callback signature before processing
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                <p>
                  <span className="font-medium">Idempotency:</span> Use transaction ID as idempotency key to prevent duplicate processing
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                <p>
                  <span className="font-medium">Timeout handling:</span> Set 2-minute timeout, then query M-Pesa status API for reconciliation
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                <p>
                  <span className="font-medium">Job queue:</span> Use BullMQ for retry logic with exponential backoff (3 retries max)
                </p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 flex-shrink-0" />
                <p>
                  <span className="font-medium">Customer UX:</span> Show "Processing payment..." state with 2min countdown, then fallback message
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-6">
            <div className="p-4 rounded-lg border border-border bg-card">
              <p className="text-sm text-muted-foreground mb-1">Success Rate Target</p>
              <p className="text-2xl font-semibold text-green-600">98%+</p>
            </div>
            <div className="p-4 rounded-lg border border-border bg-card">
              <p className="text-sm text-muted-foreground mb-1">Expected Timeout Rate</p>
              <p className="text-2xl font-semibold text-yellow-600">1-2%</p>
            </div>
            <div className="p-4 rounded-lg border border-border bg-card">
              <p className="text-sm text-muted-foreground mb-1">Manual Reconciliation</p>
              <p className="text-2xl font-semibold text-orange-600">&lt;0.5%</p>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
