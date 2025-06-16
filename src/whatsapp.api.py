from twilio.rest import Client
from config import TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, WHATSAPP_FROM, WHATSAPP_TO

client = Client(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)

def send_whatsapp_message(body):
    message = client.messages.create(
        body=body,
        from_=WHATSAPP_FROM,
        to=WHATSAPP_TO
    )
    return message.sid
