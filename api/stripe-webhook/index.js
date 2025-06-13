const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { CosmosClient } = require('@azure/cosmos');
const { v4: uuidv4 } = require('uuid');

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('fdi-chatbot');
const organizationsContainer = database.container('organizations');
const usersContainer = database.container('users');

module.exports = async function (context, req) {
    const sig = req.headers['stripe-signature'];
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    let event;

    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
    } catch (err) {
        context.log.error('Webhook signature verification failed:', err.message);
        context.res = { status: 400, body: `Webhook Error: ${err.message}` };
        return;
    }

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed':
            await handleCheckoutCompleted(context, event.data.object);
            break;
        case 'customer.subscription.updated':
            await handleSubscriptionUpdated(context, event.data.object);
            break;
        case 'customer.subscription.deleted':
            await handleSubscriptionDeleted(context, event.data.object);
            break;
        case 'invoice.payment_failed':
            await handlePaymentFailed(context, event.data.object);
            break;
        default:
            context.log(`Unhandled event type ${event.type}`);
    }

    context.res = { status: 200, body: { received: true } };
};

async function handleCheckoutCompleted(context, session) {
    try {
        context.log('Processing completed checkout session:', session.id);

        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        const metadata = session.metadata;

        // Create organization record
        const organizationId = uuidv4();
        const organization = {
            id: organizationId,
            name: metadata.companyName,
            subscriptionId: subscription.id,
            licenseCount: parseInt(metadata.licenseCount),
            status: 'active',
            adminEmail: metadata.email,
            createdAt: new Date().toISOString(),
            trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null
        };

        await organizationsContainer.items.create(organization);

        // Create admin user record
        const userId = uuidv4();
        const adminUser = {
            id: userId,
            email: metadata.email,
            firstName: metadata.firstName,
            lastName: metadata.lastName,
            phone: metadata.phone,
            organizationId: organizationId,
            role: 'admin',
            status: 'active',
            createdAt: new Date().toISOString(),
            lastLogin: null
        };

        await usersContainer.items.create(adminUser);

        // TODO: Send welcome email with login instructions
        await sendWelcomeEmail(adminUser, organization);

        context.log('Organization and admin user created successfully');

    } catch (error) {
        context.log.error('Error handling checkout completion:', error);
        throw error;
    }
}

async function handleSubscriptionUpdated(context, subscription) {
    try {
        context.log('Processing subscription update:', subscription.id);

        // Find organization by subscription ID
        const querySpec = {
            query: "SELECT * FROM c WHERE c.subscriptionId = @subscriptionId",
            parameters: [{ name: "@subscriptionId", value: subscription.id }]
        };

        const { resources } = await organizationsContainer.items.query(querySpec).fetchAll();

        if (resources.length === 0) {
            context.log.error('Organization not found for subscription:', subscription.id);
            return;
        }

        const organization = resources[0];

        // Update organization status based on subscription
        const updates = {
            status: subscription.status,
            licenseCount: subscription.items.data[0].quantity,
        };

        if (subscription.cancel_at_period_end) {
            updates.cancelAtPeriodEnd = true;
            updates.cancelAt = new Date(subscription.current_period_end * 1000).toISOString();
        }

        await organizationsContainer.item(organization.id, organization.id).patch([
            { op: 'replace', path: '/status', value: updates.status },
            { op: 'replace', path: '/licenseCount', value: updates.licenseCount }
        ]);

        context.log('Organization updated successfully');

    } catch (error) {
        context.log.error('Error handling subscription update:', error);
        throw error;
    }
}

async function handleSubscriptionDeleted(context, subscription) {
    try {
        context.log('Processing subscription deletion:', subscription.id);

        // Find and deactivate organization
        const querySpec = {
            query: "SELECT * FROM c WHERE c.subscriptionId = @subscriptionId",
            parameters: [{ name: "@subscriptionId", value: subscription.id }]
        };

        const { resources } = await organizationsContainer.items.query(querySpec).fetchAll();

        if (resources.length > 0) {
            const organization = resources[0];
            
            await organizationsContainer.item(organization.id, organization.id).patch([
                { op: 'replace', path: '/status', value: 'canceled' }
            ]);

            // TODO: Send cancellation email
            context.log('Organization deactivated successfully');
        }

    } catch (error) {
        context.log.error('Error handling subscription deletion:', error);
        throw error;
    }
}

async function handlePaymentFailed(context, invoice) {
    try {
        context.log('Processing payment failure for invoice:', invoice.id);

        const subscription = await stripe.subscriptions.retrieve(invoice.subscription);
        
        // Find organization
        const querySpec = {
            query: "SELECT * FROM c WHERE c.subscriptionId = @subscriptionId",
            parameters: [{ name: "@subscriptionId", value: subscription.id }]
        };

        const { resources } = await organizationsContainer.items.query(querySpec).fetchAll();

        if (resources.length > 0) {
            const organization = resources[0];
            
            // TODO: Send payment failure email
            // TODO: Implement grace period logic
            
            context.log('Payment failure processed for organization:', organization.id);
        }

    } catch (error) {
        context.log.error('Error handling payment failure:', error);
        throw error;
    }
}

async function sendWelcomeEmail(user, organization) {
    // TODO: Implement email sending using Azure Communication Services
    // or SendGrid
    console.log(`Welcome email would be sent to ${user.email}`);
}