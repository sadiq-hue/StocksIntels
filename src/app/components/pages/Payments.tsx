import { useEffect, useState } from "react";
import { Search, Filter, Send, CheckCircle, Clock, XCircle, X, Mail, DollarSign, AlertCircle } from "lucide-react";
import { api, type Payment } from "../../../lib/api";
import { useBusiness } from "../../../lib/business-context";

const BACKEND_API_URL = import.meta.env.VITE_BACKEND_API_URL || 'http://localhost:3001';

const statusConfig: Record<string, { icon: typeof CheckCircle; color: string; bg: string; label: string }> = {
  confirmed: { icon: CheckCircle, color: "text-green-600", bg: "bg-green-100", label: "Paid" },
  paid: { icon: CheckCircle, color: "text-green-600", bg: "bg-green-100", label: "Paid" },
  pending: { icon: Clock, color: "text-yellow-600", bg: "bg-yellow-100", label: "Pending" },
  initiated: { icon: Clock, color: "text-yellow-600", bg: "bg-yellow-100", label: "Pending" },
  failed: { icon: XCircle, color: "text-red-600", bg: "bg-red-100", label: "Failed" },
  timeout: { icon: XCircle, color: "text-red-600", bg: "bg-red-100", label: "Timeout" },
  refunded: { icon: XCircle, color: "text-purple-600", bg: "bg-purple-100", label: "Refunded" },
};

export function Payments() {
  const { business } = useBusiness();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPaymentRequestModal, setShowPaymentRequestModal] = useState(false);
  const [paymentRequestData, setPaymentRequestData] = useState({
    customerName: "",
    customerEmail: "",
    company: "",
    amount: "",
    description: "",
    dueDate: "",
    paymentMethod: "M-Pesa"
  });
  const [isSendingRequest, setIsSendingRequest] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [emailError, setEmailError] = useState("");

  useEffect(() => {
    if (!business) return;
    api.payments.list({ business_id: business.id })
      .then(res => setPayments(res.payments))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [business]);

  // Check configuration on mount
  useEffect(() => {
    api.health()
      .then(data => console.log('✓ Backend API is healthy:', data))
      .catch(() => console.warn('⚠️ Backend API not accessible at', BACKEND_API_URL));
  }, []);

  const totalPaid = payments.filter((p) => p.status === "confirmed" || p.status === "paid").reduce((sum, p) => sum + p.amount, 0);
  const totalPending = payments.filter((p) => p.status === "pending" || p.status === "initiated").reduce((sum, p) => sum + p.amount, 0);
  const totalFailed = payments.filter((p) => p.status === "failed" || p.status === "timeout").reduce((sum, p) => sum + p.amount, 0);

  const formatCurrency = (amount: number) =>
    amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0 });

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatTime = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  };

  // Handle form input changes
  const handleInputChange = (field: string, value: string) => {
    setPaymentRequestData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  // Handle opening payment request modal
  const handleSendPaymentRequest = () => {
    setShowPaymentRequestModal(true);
    setRequestSent(false);
  };

  // Email validation function
  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  // Generate payment request email template
  const generatePaymentEmailTemplate = (data: typeof paymentRequestData) => {
    const dueDateText = data.dueDate ? ` due by ${new Date(data.dueDate).toLocaleDateString()}` : '';
    const companyText = data.company ? ` at ${data.company}` : '';

    return {
      to: data.customerEmail,
      subject: `Payment Request - $${data.amount}${companyText}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333; border-bottom: 2px solid #007bff; padding-bottom: 10px;">
            Payment Request
          </h2>

          <p>Dear ${data.customerName},</p>

          <p>We hope this email finds you well. This is a payment request for the following:</p>

          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h3 style="margin-top: 0; color: #333;">Payment Details</h3>
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; font-weight: bold;">Amount:</td>
                <td style="padding: 8px 0; color: #007bff; font-size: 18px; font-weight: bold;">
                  $${parseFloat(data.amount).toLocaleString()}
                </td>
              </tr>
              <tr>
                <td style="padding: 8px 0; font-weight: bold;">Payment Method:</td>
                <td style="padding: 8px 0;">${data.paymentMethod}</td>
              </tr>
              ${data.dueDate ? `
              <tr>
                <td style="padding: 8px 0; font-weight: bold;">Due Date:</td>
                <td style="padding: 8px 0;">${new Date(data.dueDate).toLocaleDateString()}</td>
              </tr>
              ` : ''}
              ${data.company ? `
              <tr>
                <td style="padding: 8px 0; font-weight: bold;">Company:</td>
                <td style="padding: 8px 0;">${data.company}</td>
              </tr>
              ` : ''}
            </table>
          </div>

          ${data.description ? `
          <div style="background-color: #e9ecef; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h4 style="margin-top: 0; color: #333;">Description</h4>
            <p style="margin-bottom: 0;">${data.description}</p>
          </div>
          ` : ''}

          <div style="background-color: #d4edda; border: 1px solid #c3e6cb; padding: 15px; border-radius: 8px; margin: 20px 0;">
            <h4 style="margin-top: 0; color: #155724;">How to Pay</h4>
            <p style="margin-bottom: 0; color: #155724;">
              Please use the payment method specified above. If you have any questions about this payment request,
              feel free to reply to this email or contact our billing department.
            </p>
          </div>

          <p>Thank you for your prompt attention to this matter.</p>

          <p>Best regards,<br>
          LeadFlow AI Billing Team<br>
          billing@leadflow.ai<br>
          ${new Date().toLocaleDateString()}</p>
        </div>
      `,
      text: `
Payment Request

Dear ${data.customerName},

We hope this email finds you well. This is a payment request for the following:

Amount: $${parseFloat(data.amount).toLocaleString()}
Payment Method: ${data.paymentMethod}
${data.dueDate ? `Due Date: ${new Date(data.dueDate).toLocaleDateString()}` : ''}
${data.company ? `Company: ${data.company}` : ''}

${data.description ? `Description: ${data.description}` : ''}

Please use the payment method specified above. If you have any questions about this payment request,
feel free to reply to this email or contact our billing department.

Thank you for your prompt attention to this matter.

Best regards,
LeadFlow AI Billing Team
billing@leadflow.ai
${new Date().toLocaleDateString()}
      `
    };
  };

  // Send email function (via Backend API)
  const sendPaymentEmail = async (emailData: typeof paymentRequestData) => {
    const emailTemplate = generatePaymentEmailTemplate(emailData);

    console.log('Sending payment email to:', emailTemplate.to);

    try {
      const result = await api.sendPaymentEmail({
        to: emailTemplate.to,
        subject: emailTemplate.subject,
        html: emailTemplate.html,
        text: emailTemplate.text,
        customerName: emailData.customerName,
        company: emailData.company,
        amount: emailData.amount,
        paymentMethod: emailData.paymentMethod,
        dueDate: emailData.dueDate,
        description: emailData.description,
      });
      console.log('✓ Email sent successfully via backend:', result);
      return result;

    } catch (error) {
      console.error('Error sending email:', error);
      throw error;
    }
  };

  // Handle sending payment request
  const handleSubmitPaymentRequest = async () => {
    // Clear previous errors
    setEmailError("");

    // Validate required fields
    if (!paymentRequestData.customerName.trim()) {
      setEmailError("Customer name is required");
      return;
    }

    if (!paymentRequestData.customerEmail.trim()) {
      setEmailError("Customer email is required");
      return;
    }

    if (!validateEmail(paymentRequestData.customerEmail)) {
      setEmailError("Please enter a valid email address");
      return;
    }

    if (!paymentRequestData.amount || parseFloat(paymentRequestData.amount) <= 0) {
      setEmailError("Please enter a valid amount greater than 0");
      return;
    }

    setIsSendingRequest(true);

    try {
      // Send the payment email
      const emailResult = await sendPaymentEmail(paymentRequestData);

      console.log("Payment email sent successfully:", emailResult);

      // Show success state
      setRequestSent(true);

      // Reset form after successful submission
      setTimeout(() => {
        setShowPaymentRequestModal(false);
        setPaymentRequestData({
          customerName: "",
          customerEmail: "",
          company: "",
          amount: "",
          description: "",
          dueDate: "",
          paymentMethod: "M-Pesa"
        });
        setRequestSent(false);
        setEmailError("");
      }, 3000); // Show success message for 3 seconds

    } catch (error) {
      console.error("Error sending payment email:", error);
      setEmailError(
        error instanceof Error
          ? error.message
          : "Failed to send payment request email. Please try again."
      );
    } finally {
      setIsSendingRequest(false);
    }
  };

  // Handle sending payment reminder
  const handleSendReminder = async (payment: Payment) => {
    try {
      const reminderData = {
        customerName: payment.id.slice(0, 8),
        customerEmail: `${payment.id.slice(0, 8)}@example.com`,
        company: '',
        amount: payment.amount.toString(),
        description: `Payment reminder for ${payment.provider} payment #${payment.id.slice(0, 8)}`,
        dueDate: new Date().toISOString().split('T')[0],
        paymentMethod: payment.provider,
      };
      await sendPaymentEmail(reminderData);
      alert(`Payment reminder sent successfully`);
    } catch (error) {
      console.error("Error sending reminder:", error);
      alert("Failed to send reminder. Please try again.");
    }
  };

  return (
    <div className="h-full p-8 space-y-6 overflow-y-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1>Payments</h1>
          <p className="text-muted-foreground">Track and manage customer payments</p>
        </div>
        <button
          onClick={handleSendPaymentRequest}
          className="px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-2"
        >
          <Send className="w-5 h-5" />
          Send Payment Request
        </button>
      </div>

      <div className="grid grid-cols-4 gap-6">
        <div className="p-6 border border-border rounded-xl bg-card">
          <p className="text-muted-foreground mb-2">Total Paid</p>
          <p className="text-2xl font-semibold text-green-600">{formatCurrency(totalPaid)}</p>
        </div>
        <div className="p-6 border border-border rounded-xl bg-card">
          <p className="text-muted-foreground mb-2">Pending</p>
          <p className="text-2xl font-semibold text-yellow-600">{formatCurrency(totalPending)}</p>
        </div>
        <div className="p-6 border border-border rounded-xl bg-card">
          <p className="text-muted-foreground mb-2">Failed/Timeout</p>
          <p className="text-2xl font-semibold text-red-600">{formatCurrency(totalFailed)}</p>
        </div>
        <div className="p-6 border border-border rounded-xl bg-card">
          <p className="text-muted-foreground mb-2">Total Transactions</p>
          <p className="text-2xl font-semibold">{loading ? '...' : payments.length}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search payments by customer or company..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-input-background border border-border"
          />
        </div>
        <button className="px-4 py-2 rounded-lg border border-border hover:bg-accent transition-colors flex items-center gap-2">
          <Filter className="w-5 h-5" />
          Filter
        </button>
      </div>

      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="px-6 py-3 text-left">Payment ID</th>
              <th className="px-6 py-3 text-left">Amount</th>
              <th className="px-6 py-3 text-left">Status</th>
              <th className="px-6 py-3 text-left">Method</th>
              <th className="px-6 py-3 text-left">Date & Time</th>
              <th className="px-6 py-3 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">Loading payments...</td></tr>
            ) : payments.length === 0 ? (
              <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">No payments found</td></tr>
            ) : (
              payments.map((payment) => {
                const config = statusConfig[payment.status] || statusConfig.pending;
                const Icon = config.icon;
                return (
                  <tr key={payment.id} className="border-b border-border hover:bg-accent/50 transition-colors">
                    <td className="px-6 py-4">
                      <span className="font-mono text-sm">{payment.id.slice(0, 8)}...</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className="font-semibold">{formatCurrency(payment.amount)}</span>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-3 py-1 rounded-full text-sm flex items-center gap-2 w-fit ${config.bg} ${config.color}`}>
                        <Icon className="w-4 h-4" />
                        {config.label}
                      </span>
                    </td>
                    <td className="px-6 py-4 capitalize">{payment.provider}</td>
                    <td className="px-6 py-4 text-muted-foreground">
                      <div>
                        <p>{formatDate(payment.paid_at || payment.created_at)}</p>
                        <p className="text-sm">{formatTime(payment.created_at)}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      {payment.status !== "paid" && payment.status !== "confirmed" && (
                        <button
                          onClick={() => handleSendReminder(payment)}
                          className="px-3 py-1 rounded-lg border border-border hover:bg-accent transition-colors text-sm"
                        >
                          Send Reminder
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Payment Request Modal */}
      {showPaymentRequestModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-background border border-border rounded-xl p-6 w-full max-w-sm mx-auto max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-xl font-semibold">Send Payment Request</h2>
              <button
                onClick={() => setShowPaymentRequestModal(false)}
                className="p-2 hover:bg-accent rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {requestSent ? (
              <div className="text-center py-8">
                <CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Payment Request Sent!</h3>
                <p className="text-muted-foreground">
                  Your payment request has been sent successfully to {paymentRequestData.customerName}.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {emailError && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />
                    <span className="text-sm">{emailError}</span>
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium mb-2">Customer Name *</label>
                  <input
                    type="text"
                    value={paymentRequestData.customerName}
                    onChange={(e) => handleInputChange('customerName', e.target.value)}
                    placeholder="Enter customer name"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-input-background"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Customer Email *</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="email"
                      value={paymentRequestData.customerEmail}
                      onChange={(e) => handleInputChange('customerEmail', e.target.value)}
                      placeholder="customer@example.com"
                      className="w-full pl-10 pr-3 py-2 rounded-lg border border-border bg-input-background"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Company</label>
                  <input
                    type="text"
                    value={paymentRequestData.company}
                    onChange={(e) => handleInputChange('company', e.target.value)}
                    placeholder="Enter company name"
                    className="w-full px-3 py-2 rounded-lg border border-border bg-input-background"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Amount *</label>
                  <div className="relative">
                    <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      type="number"
                      value={paymentRequestData.amount}
                      onChange={(e) => handleInputChange('amount', e.target.value)}
                      placeholder="0.00"
                      className="w-full pl-10 pr-3 py-2 rounded-lg border border-border bg-input-background"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Payment Method</label>
                  <select
                    value={paymentRequestData.paymentMethod}
                    onChange={(e) => handleInputChange('paymentMethod', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-input-background"
                  >
                    <option value="M-Pesa">M-Pesa</option>
                    <option value="Bank Transfer">Bank Transfer</option>
                    <option value="PayPal">PayPal</option>
                    <option value="Stripe">Stripe</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Due Date</label>
                  <input
                    type="date"
                    value={paymentRequestData.dueDate}
                    onChange={(e) => handleInputChange('dueDate', e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-input-background"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2">Description</label>
                  <textarea
                    value={paymentRequestData.description}
                    onChange={(e) => handleInputChange('description', e.target.value)}
                    placeholder="Payment for services..."
                    rows={3}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-input-background resize-none"
                  />
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    onClick={() => setShowPaymentRequestModal(false)}
                    className="flex-1 px-4 py-2 rounded-lg border border-border hover:bg-accent transition-colors"
                    disabled={isSendingRequest}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmitPaymentRequest}
                    disabled={isSendingRequest}
                    className="flex-1 px-4 py-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {isSendingRequest ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Sending...
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4" />
                        Send Request
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
